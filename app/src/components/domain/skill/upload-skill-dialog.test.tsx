import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UPLOAD_SKILL_FORM_ID, UploadSkillForm } from './upload-skill-dialog';

const mutate = vi.fn();
const navigate = vi.fn();

vi.mock('@/lib/queries', () => ({ useImportSkill: () => ({ mutate, isPending: false }) }));
vi.mock('@/lib/toast', () => ({ useToasts: () => ({ success: vi.fn(), error: vi.fn(), apiError: vi.fn() }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
// jsdom's `File` cannot be read as bytes, so the picker is a button that hands over one Markdown file.
vi.mock('@/components/ui/file-picker', () => ({
  FilePickerButton: ({ label, onPickMany }: { label: string; onPickMany: (files: unknown[]) => void }) => (
    <button
      type="button"
      onClick={() =>
        onPickMany([{ name: PICKED_NAME, path: PICKED_NAME, type: 'text/markdown', text: '', bytes: PICKED_BYTES }])
      }
    >
      {label}
    </button>
  ),
}));

const PICKED_NAME = 'My Skill.md';
const PICKED_BYTES = new TextEncoder().encode('# Hello\n');

/** The form with the submit button its dialog would draw in the footer. */
function renderForm(onStatusChange = vi.fn(), onImported = vi.fn()) {
  render(
    <>
      <UploadSkillForm onStatusChange={onStatusChange} onImported={onImported} />
      <button type="submit" form={UPLOAD_SKILL_FORM_ID}>
        Import skill
      </button>
    </>,
  );
  return { onStatusChange, onImported };
}

/** Pick the Markdown file through the file picker. */
async function pickMarkdown() {
  await userEvent.click(screen.getByRole('button', { name: 'Choose .md or .zip' }));
}

describe('UploadSkillForm', () => {
  beforeEach(() => {
    mutate.mockReset();
    navigate.mockReset();
  });

  it('names the skill after the picked file and imports it', async () => {
    const { onStatusChange, onImported } = renderForm();
    mutate.mockImplementation((_body, options) => options.onSuccess({ name: 'my-skill' }));

    await pickMarkdown();

    expect(await screen.findByLabelText(/^Skill id/)).toHaveValue('my-skill');
    await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({ ready: true, pending: false, dirty: true }));

    await userEvent.click(screen.getByRole('button', { name: 'Import skill' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({ name: 'my-skill', format: 'file' });
    expect(onImported).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: '/skills/$name', params: { name: 'my-skill' } });
  });

  it('refuses an id that is not a slug', async () => {
    const { onStatusChange } = renderForm();

    await pickMarkdown();
    await userEvent.type(await screen.findByLabelText(/^Skill id/), ' Nope');
    await userEvent.click(screen.getByRole('button', { name: 'Import skill' }));

    expect(screen.getByText(/Must be a lowercase slug/)).toBeInTheDocument();
    await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({ ready: false, pending: false, dirty: true }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('is not dirty before anything is picked', () => {
    const { onStatusChange } = renderForm();

    expect(onStatusChange).toHaveBeenLastCalledWith({ ready: false, pending: false, dirty: false });
  });
});
