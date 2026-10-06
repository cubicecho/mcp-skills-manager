import type { SkillDetail } from '@mcp-skills/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkSourceButton } from './link-source-button';

const mutate = vi.fn();
const success = vi.fn();

vi.mock('@/lib/queries', () => ({ useLinkSkillSource: () => ({ mutate, isPending: false }) }));
vi.mock('@/lib/toast', () => ({ useToasts: () => ({ success, error: vi.fn(), apiError: vi.fn() }) }));

const skill = { name: 'my-skill' } as SkillDetail;

/** The button, with its dialog already opened. */
async function renderOpenDialog() {
  render(<LinkSourceButton skill={skill} />);
  await userEvent.click(screen.getByRole('button', { name: 'Link to Git source' }));
}

describe('LinkSourceButton', () => {
  beforeEach(() => {
    mutate.mockReset();
    success.mockReset();
  });

  it('keeps the submit disabled until the source is valid', async () => {
    await renderOpenDialog();

    expect(screen.getByRole('button', { name: /Link & replace/ })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^Repository URL/), 'https://user:token@github.com/o/r');
    expect(screen.getByText(/without embedded credentials/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Link & replace/ })).toBeDisabled();
  });

  it('links the pasted folder and closes', async () => {
    mutate.mockImplementation((_source, options) => options.onSuccess());
    await renderOpenDialog();

    await userEvent.click(screen.getByLabelText(/^Repository URL/));
    await userEvent.paste('https://github.com/cubicecho/cubeui/tree/main/skills/cubeui');
    await userEvent.click(screen.getByRole('button', { name: /Link & replace/ }));

    await waitFor(() =>
      expect(mutate.mock.calls[0]?.[0]).toEqual({
        repo: 'https://github.com/cubicecho/cubeui',
        ref: 'main',
        path: 'skills/cubeui',
      }),
    );
    expect(success).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText(/^Repository URL/)).not.toBeInTheDocument());
  });

  it('starts empty again after being cancelled', async () => {
    await renderOpenDialog();
    await userEvent.type(screen.getByLabelText(/^Branch or tag/), 'main');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // Typed text is guarded, so cancelling asks first.
    await userEvent.click(await screen.findByRole('button', { name: /Discard/ }));
    await waitFor(() => expect(screen.queryByLabelText(/^Branch or tag/)).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Link to Git source' }));

    expect(screen.getByLabelText(/^Branch or tag/)).toHaveValue('');
  });
});
