import type { SkillDetail } from '@mcp-skills/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillBodyEditor } from './skill-body-editor';

type MutateOptions = { onSuccess?: () => void };
const mutate = vi.fn((_input: unknown, options?: MutateOptions) => options?.onSuccess?.());
const toastSuccess = vi.fn();

vi.mock('@/lib/queries', () => ({
  useSkills: () => ({ data: [{ name: 'other', tags: ['git', 'style'] }] }),
  useUpdateSkill: () => ({ mutate, isPending: false }),
}));

vi.mock('@/lib/toast', () => ({
  useToasts: () => ({ success: toastSuccess, error: vi.fn(), apiError: vi.fn() }),
}));

const SKILL = {
  name: 'commit-messages',
  description: 'Write commits',
  body: '# Commits',
  tags: ['git'],
  format: 'dir',
  path: 'commit-messages/SKILL.md',
  global: true,
  readOnly: false,
  files: [],
  frontmatter: {},
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as SkillDetail;

const saveButton = () => screen.getByRole('button', { name: /Save/ });
const pressSaveChord = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

describe('SkillBodyEditor', () => {
  beforeEach(() => {
    mutate.mockClear();
    toastSuccess.mockClear();
  });

  it('starts clean, showing the skill as saved', () => {
    const onDirtyChange = vi.fn();
    render(<SkillBodyEditor skill={SKILL} onDirtyChange={onDirtyChange} onClose={() => {}} />);

    expect(screen.getByLabelText(/^Description/)).toHaveValue('Write commits');
    expect(screen.getByLabelText('Skill body')).toHaveValue('# Commits');
    expect(saveButton()).toBeDisabled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('is dirty after an edit and clean again once the edit is undone', async () => {
    const onDirtyChange = vi.fn();
    render(<SkillBodyEditor skill={SKILL} onDirtyChange={onDirtyChange} onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText('Skill body'), '!');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(saveButton()).toBeEnabled();

    await userEvent.type(screen.getByLabelText('Skill body'), '{Backspace}');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(saveButton()).toBeDisabled();
  });

  it('saves the description, body and tags together', async () => {
    render(<SkillBodyEditor skill={SKILL} onDirtyChange={() => {}} onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText(/^Description/), ' well');
    await userEvent.type(screen.getByLabelText('Skill body'), '!');
    await userEvent.click(screen.getByRole('combobox', { name: /Tags/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'style' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(saveButton());

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      description: 'Write commits well',
      body: '# Commits!',
      tags: ['git', 'style'],
    });
    expect(toastSuccess).toHaveBeenCalledWith('Skill saved');
  });

  it('is clean once the saved skill comes back', async () => {
    const onDirtyChange = vi.fn();
    const { rerender } = render(<SkillBodyEditor skill={SKILL} onDirtyChange={onDirtyChange} onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText('Skill body'), '!');
    await userEvent.click(saveButton());
    rerender(
      <SkillBodyEditor skill={{ ...SKILL, body: '# Commits!' }} onDirtyChange={onDirtyChange} onClose={() => {}} />,
    );

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(saveButton()).toBeDisabled();
  });

  it('saves on Ctrl+S only when there is something to save', async () => {
    render(<SkillBodyEditor skill={SKILL} onDirtyChange={() => {}} onClose={() => {}} />);

    pressSaveChord();
    expect(mutate).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Skill body'), '!');
    pressSaveChord();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({ body: '# Commits!' });
  });

  it('hands Close to the caller, which owns the unsaved-changes question', async () => {
    const onClose = vi.fn();
    render(<SkillBodyEditor skill={SKILL} onDirtyChange={() => {}} onClose={onClose} />);

    await userEvent.type(screen.getByLabelText('Skill body'), '!');
    await userEvent.click(screen.getByRole('button', { name: /Close/ }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });
});
