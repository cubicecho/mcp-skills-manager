import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type Ref } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorHandle } from './editor-frame';
import { SupportingFileEditor } from './supporting-file-editor';

type MutateOptions = { onSuccess?: () => void };
const mutate = vi.fn((_input: unknown, options?: MutateOptions) => options?.onSuccess?.());
const toastSuccess = vi.fn();
let fileQuery: { data?: { content: string; binary: boolean; size: number }; isPending: boolean; error: null };

vi.mock('@/lib/queries', () => ({
  useSkillFileContent: () => ({ ...fileQuery, refetch: vi.fn() }),
  useWriteSkillFile: () => ({ mutate, isPending: false }),
}));

vi.mock('@/lib/toast', () => ({
  useToasts: () => ({ success: toastSuccess, error: vi.fn(), apiError: vi.fn() }),
}));

const PATH = 'reference/notes.md';
// The card is labelled by the path too, so the textarea is found by its role.
const editor = () => screen.getByRole('textbox', { name: PATH });
const saveButton = () => screen.getByRole('button', { name: /Save/ });
const pressSaveChord = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

function renderEditor(handle?: Ref<EditorHandle>) {
  return render(<SupportingFileEditor skillName="pdf-forms" path={PATH} ref={handle} onClose={() => {}} />);
}

describe('SupportingFileEditor', () => {
  beforeEach(() => {
    mutate.mockClear();
    toastSuccess.mockClear();
    fileQuery = { data: { content: '# Notes', binary: false, size: 7 }, isPending: false, error: null };
  });

  it('starts clean, showing the file as saved', () => {
    const handle = createRef<EditorHandle>();
    renderEditor(handle);

    expect(editor()).toHaveValue('# Notes');
    expect(saveButton()).toBeDisabled();
    expect(handle.current?.hasUnsavedChanges()).toBe(false);
  });

  it('is dirty after an edit and clean again once the edit is undone', async () => {
    const handle = createRef<EditorHandle>();
    renderEditor(handle);

    await userEvent.type(editor(), '!');
    expect(handle.current?.hasUnsavedChanges()).toBe(true);
    expect(saveButton()).toBeEnabled();

    await userEvent.type(editor(), '{Backspace}');
    expect(handle.current?.hasUnsavedChanges()).toBe(false);
  });

  it('writes the file and is clean once the write succeeds', async () => {
    const handle = createRef<EditorHandle>();
    renderEditor(handle);

    await userEvent.type(editor(), '!');
    await userEvent.click(saveButton());

    expect(mutate.mock.calls[0]?.[0]).toEqual({ path: PATH, content: '# Notes!', encoding: 'utf8' });
    expect(toastSuccess).toHaveBeenCalledWith(`Saved ${PATH}`);
    expect(handle.current?.hasUnsavedChanges()).toBe(false);
    expect(saveButton()).toBeDisabled();
    expect(editor()).toHaveValue('# Notes!');
  });

  it('keeps what is typed while the saved file is still being read back', async () => {
    const view = renderEditor();

    await userEvent.type(editor(), '!');
    await userEvent.click(saveButton());
    await userEvent.type(editor(), '?');

    // The refetch a save sets off lands, carrying the text as saved.
    fileQuery = { data: { content: '# Notes!', binary: false, size: 8 }, isPending: false, error: null };
    view.rerender(<SupportingFileEditor skillName="pdf-forms" path={PATH} onClose={() => {}} />);

    expect(editor()).toHaveValue('# Notes!?');
    expect(saveButton()).toBeEnabled();
  });

  it('takes a changed file as read when nothing is unsaved', () => {
    const view = renderEditor();

    fileQuery = { data: { content: '# Rewritten', binary: false, size: 11 }, isPending: false, error: null };
    view.rerender(<SupportingFileEditor skillName="pdf-forms" path={PATH} onClose={() => {}} />);

    expect(editor()).toHaveValue('# Rewritten');
    expect(saveButton()).toBeDisabled();
  });

  it('saves on Ctrl+S only when there is something to save', async () => {
    renderEditor();

    pressSaveChord();
    expect(mutate).not.toHaveBeenCalled();

    await userEvent.type(editor(), '!');
    pressSaveChord();
    // The form submits on the next tick.
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  });

  it('offers no editor for a binary file', () => {
    fileQuery = { data: { content: '', binary: true, size: 2048 }, isPending: false, error: null };
    renderEditor();

    expect(screen.getByText(/This file is binary/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: PATH })).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('offers no editor while the file loads', () => {
    fileQuery = { isPending: true, error: null };
    renderEditor();

    expect(screen.queryByRole('textbox', { name: PATH })).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });
});
