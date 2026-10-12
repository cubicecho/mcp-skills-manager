import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aSkill } from '@/test/fixtures';
import { toasts } from '@/test/toasts';
import type { EditorHandle } from './editor-frame';
import { SkillBodyEditor } from './skill-body-editor';

type MutateOptions = { onSuccess?: () => void };
const mutate = vi.fn((_input: unknown, options?: MutateOptions) => options?.onSuccess?.());

vi.mock('@/lib/queries', () => ({
  useSkills: () => ({ data: [{ name: 'other', tags: ['git', 'style'] }] }),
  useUpdateSkill: () => ({ mutate, isPending: false }),
}));

vi.mock('@/lib/toast', async () => (await import('@/test/toasts')).mockToasts());

const SKILL = aSkill({ description: 'Write commits', body: '# Commits', tags: ['git'] });

const saveButton = () => screen.getByRole('button', { name: /Save/ });
const pressSaveChord = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

describe('SkillBodyEditor', () => {
  beforeEach(() => {
    mutate.mockClear();
    toasts.success.mockClear();
  });

  it('starts clean, showing the skill as saved', () => {
    const handle = createRef<EditorHandle>();
    render(<SkillBodyEditor skill={SKILL} ref={handle} onClose={() => {}} />);

    expect(screen.getByLabelText(/^Description/)).toHaveValue('Write commits');
    expect(screen.getByLabelText('Skill body')).toHaveValue('# Commits');
    expect(saveButton()).toBeDisabled();
    expect(handle.current?.hasUnsavedChanges()).toBe(false);
  });

  it('is dirty after an edit and clean again once the edit is undone', async () => {
    const handle = createRef<EditorHandle>();
    render(<SkillBodyEditor skill={SKILL} ref={handle} onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText('Skill body'), '!');
    expect(handle.current?.hasUnsavedChanges()).toBe(true);
    expect(saveButton()).toBeEnabled();

    await userEvent.type(screen.getByLabelText('Skill body'), '{Backspace}');
    expect(handle.current?.hasUnsavedChanges()).toBe(false);
    expect(saveButton()).toBeDisabled();
  });

  it('saves the description, body and tags together', async () => {
    render(<SkillBodyEditor skill={SKILL} onClose={() => {}} />);

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
    expect(toasts.success).toHaveBeenCalledWith('Skill saved');
  });

  it('is clean once the saved skill comes back', async () => {
    const handle = createRef<EditorHandle>();
    const { rerender } = render(<SkillBodyEditor skill={SKILL} ref={handle} onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText('Skill body'), '!');
    await userEvent.click(saveButton());
    rerender(<SkillBodyEditor skill={{ ...SKILL, body: '# Commits!' }} ref={handle} onClose={() => {}} />);

    expect(handle.current?.hasUnsavedChanges()).toBe(false);
    expect(saveButton()).toBeDisabled();
  });

  it('saves on Ctrl+S only when there is something to save', async () => {
    render(<SkillBodyEditor skill={SKILL} onClose={() => {}} />);

    pressSaveChord();
    expect(mutate).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Skill body'), '!');
    pressSaveChord();
    // The form submits on the next tick.
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({ body: '# Commits!' });
  });

  it('hands Close to the caller, which owns the unsaved-changes question', async () => {
    const onClose = vi.fn();
    render(<SkillBodyEditor skill={SKILL} onClose={onClose} />);

    await userEvent.type(screen.getByLabelText('Skill body'), '!');
    await userEvent.click(screen.getByRole('button', { name: /Close/ }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });
});
