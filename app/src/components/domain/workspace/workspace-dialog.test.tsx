import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceDialog } from './workspace-dialog';

const createMutateAsync = vi.fn(async () => ({}));
const updateMutateAsync = vi.fn(async () => ({}));

vi.mock('@/lib/queries', () => ({
  useSkills: () => ({
    data: [
      { name: 'deploy', description: 'Ship it' },
      { name: 'testing', description: '' },
    ],
  }),
  useCreateWorkspace: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateWorkspace: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

vi.mock('@/lib/toast', () => ({ toastApiError: vi.fn() }));

describe('WorkspaceDialog', () => {
  beforeEach(() => {
    createMutateAsync.mockClear();
    updateMutateAsync.mockClear();
  });

  it('requires a name before creating', async () => {
    render(<WorkspaceDialog open onOpenChange={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Give the workspace a name.')).toBeInTheDocument();
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it('creates with the chosen members and no tool-mode override', async () => {
    const onOpenChange = vi.fn();
    render(<WorkspaceDialog open onOpenChange={onOpenChange} />);

    await userEvent.type(screen.getByLabelText(/^Name/), 'Backend');
    await userEvent.click(screen.getByRole('checkbox', { name: /deploy/ }));
    expect(screen.getByText('Skills (1 selected)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(createMutateAsync).toHaveBeenCalledWith({
      name: 'Backend',
      description: '',
      enabled: true,
      skills: ['deploy'],
      skillToolMode: undefined,
    });
  });

  it('clears the override with null when an edited workspace inherits', async () => {
    const onOpenChange = vi.fn();
    render(
      <WorkspaceDialog
        open
        onOpenChange={onOpenChange}
        workspace={
          {
            slug: 'backend',
            name: 'Backend',
            description: 'Services',
            enabled: false,
            skills: ['testing'],
            path: '/mcp/w/backend',
          } as never
        }
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(updateMutateAsync).toHaveBeenCalledWith({
      name: 'Backend',
      description: 'Services',
      enabled: false,
      skills: ['testing'],
      skillToolMode: null,
    });
  });
});
