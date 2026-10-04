import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GIT_SKILL_FORM_ID, GitSkillForm } from './git-skill-form';

const mutate = vi.fn();
const navigate = vi.fn();

vi.mock('@/lib/queries', () => ({ useImportGitSkill: () => ({ mutate, isPending: false }) }));
vi.mock('@/lib/toast', () => ({ useToasts: () => ({ success: vi.fn(), error: vi.fn(), apiError: vi.fn() }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

/** The form with the submit button its dialog would draw in the footer. */
function renderForm(onStatusChange = vi.fn(), onImported = vi.fn()) {
  render(
    <>
      <GitSkillForm onStatusChange={onStatusChange} onImported={onImported} />
      <button type="submit" form={GIT_SKILL_FORM_ID}>
        Link skill
      </button>
    </>,
  );
  return { onStatusChange, onImported };
}

describe('GitSkillForm', () => {
  beforeEach(() => {
    mutate.mockReset();
    navigate.mockReset();
  });

  it('fills repo, ref and folder from a pasted GitHub folder URL and imports them', async () => {
    const { onStatusChange, onImported } = renderForm();
    mutate.mockImplementation((_body, options) => options.onSuccess({ name: 'cubeui' }));

    await userEvent.click(screen.getByLabelText(/^Repository URL/));
    await userEvent.paste('https://github.com/cubicecho/cubeui/tree/main/skills/cubeui');

    expect(screen.getByLabelText(/^Repository URL/)).toHaveValue('https://github.com/cubicecho/cubeui');
    expect(screen.getByLabelText(/^Branch or tag/)).toHaveValue('main');
    expect(screen.getByLabelText(/^Folder/)).toHaveValue('skills/cubeui');
    await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith({ ready: true, pending: false, dirty: true }));

    await userEvent.click(screen.getByRole('button', { name: 'Link skill' }));

    expect(mutate.mock.calls[0]?.[0]).toEqual({
      repo: 'https://github.com/cubicecho/cubeui',
      ref: 'main',
      path: 'skills/cubeui',
    });
    expect(onImported).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: '/skills/$name', params: { name: 'cubeui' } });
  });

  it('sends only the repo and the chosen id when the ref and folder are blank', async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText(/^Repository URL/), 'git@github.com:o/r.git');
    await userEvent.type(screen.getByLabelText(/^Skill id/), 'my-skill');
    await userEvent.click(screen.getByRole('button', { name: 'Link skill' }));

    expect(mutate.mock.calls[0]?.[0]).toEqual({ repo: 'git@github.com:o/r.git', name: 'my-skill' });
  });

  it('refuses a repo URL with embedded credentials', async () => {
    const { onStatusChange } = renderForm();

    await userEvent.type(screen.getByLabelText(/^Repository URL/), 'https://user:token@github.com/o/r');
    await userEvent.click(screen.getByRole('button', { name: 'Link skill' }));

    expect(screen.getByText(/without embedded credentials/)).toBeInTheDocument();
    expect(onStatusChange).toHaveBeenLastCalledWith({ ready: false, pending: false, dirty: true });
    expect(mutate).not.toHaveBeenCalled();
  });
});
