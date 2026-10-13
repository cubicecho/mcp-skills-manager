import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aSkill } from '@/test/fixtures';
import { toasts } from '@/test/toasts';
import { SkillFlags } from './skill-flags';

type MutateOptions = { onSuccess?: () => void };
const mutate = vi.fn((_input: unknown, options?: MutateOptions) => options?.onSuccess?.());

vi.mock('@/lib/queries', () => ({
  useUpdateSkill: () => ({ mutate, isPending: false }),
}));

vi.mock('@/lib/toast', async () => (await import('@/test/toasts')).mockToasts());

describe('SkillFlags', () => {
  beforeEach(() => {
    mutate.mockClear();
    toasts.success.mockClear();
  });

  it('shows both flags as switches named by their rows', () => {
    render(<SkillFlags skill={aSkill({ global: true, readOnly: false })} />);

    expect(screen.getByRole('switch', { name: 'Serve on root /mcp' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Read-only for agents' })).not.toBeChecked();
  });

  it('takes a skill off the root endpoint and says so', async () => {
    render(<SkillFlags skill={aSkill({ global: true })} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Serve on root /mcp' }));

    expect(mutate.mock.calls[0]?.[0]).toEqual({ global: false });
    expect(toasts.success).toHaveBeenCalledWith('Now workspace-scoped — hidden from root /mcp');
  });

  it('makes a skill read-only and says so', async () => {
    render(<SkillFlags skill={aSkill({ readOnly: false })} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Read-only for agents' }));

    expect(mutate.mock.calls[0]?.[0]).toEqual({ readOnly: true });
    expect(toasts.success).toHaveBeenCalledWith('Now read-only — agents can no longer modify it');
  });
});
