import type { SkillDetail } from '@mcp-skills/shared';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { A_SOURCE, aSkill } from '@/test/fixtures';
import { SKILL_MD_KEY } from './skill-file-key';
import { SkillWorkspace } from './skill-workspace';

const onSelect = vi.fn();

vi.mock('@/lib/queries', () => ({
  useSkills: () => ({ data: [] }),
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useWriteSkillFile: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlinkSkillSource: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillFileContent: () => ({
    data: { content: '# Notes', binary: false, size: 7 },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/toast', async () => (await import('@/test/toasts')).mockToasts());

// The file list is pinned by its own tests; here it is the two rows this flow presses.
vi.mock('@/components/domain/skill/editor/files-panel', () => ({
  FilesPanel: ({
    selected,
    onSelect: select,
    onMove,
  }: {
    selected: string;
    onSelect: (path: string) => void;
    onMove: (from: string, to: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onMove('docs', 'reference')}>
        Ask to move docs
      </button>
      <p>{`Open file: ${selected}`}</p>
      <button type="button" onClick={() => select('docs/notes.md')}>
        Open notes
      </button>
      <button type="button" onClick={() => select('logo.png')}>
        Open logo
      </button>
    </div>
  ),
}));

const SKILL = aSkill({
  description: 'Write commits',
  body: '# Commits',
  files: [
    { path: 'docs/notes.md', type: 'file', size: 7 },
    { path: 'logo.png', type: 'file', size: 12 },
  ],
});

/** The skill once its `docs` folder has been renamed `reference`. */
const MOVED = aSkill({
  ...SKILL,
  files: [
    { path: 'reference/notes.md', type: 'file', size: 7 },
    { path: 'logo.png', type: 'file', size: 12 },
  ],
});

const LINKED = aSkill({ ...SKILL, source: A_SOURCE });

/** The workspace as its route holds it: the open file in state, and a way to another page. */
function Harness({ skill: first, initial }: { skill: SkillDetail; initial: string | undefined }) {
  const [selected, setSelected] = useState(initial);
  const [skill, setSkill] = useState(first);
  const router = useRouter();
  return (
    <>
      {/* Through the history, as a link goes: the test router is not the app's typed one. */}
      <button type="button" onClick={() => router.history.push('/elsewhere')}>
        Go elsewhere
      </button>
      <button type="button" onClick={() => setSkill(MOVED)}>
        Docs moved
      </button>
      <button type="button" onClick={() => setSkill(aSkill({ ...first, files: [] }))}>
        Files deleted
      </button>
      <SkillWorkspace
        skill={skill}
        selected={selected}
        startEditing={false}
        onSelect={(path) => {
          onSelect(path);
          setSelected(path);
        }}
        onEditStarted={() => {}}
        onRenamed={() => {}}
      />
    </>
  );
}

async function renderWorkspace(skill: SkillDetail = SKILL, initial?: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <Harness skill={skill} initial={initial} />,
    }),
    createRoute({ getParentRoute: () => rootRoute, path: '/elsewhere', component: () => <p>Another page</p> }),
  ]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(<RouterProvider router={router} />);
  await screen.findByText(/^Open file:/);
}

const body = () => screen.getByLabelText('Skill body');
const question = () => screen.queryByText('Discard unsaved changes?');

/** Open the skill's Markdown in the editor and change it. */
async function editBody() {
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await userEvent.type(body(), '!');
}

describe('SkillWorkspace', () => {
  beforeEach(() => {
    onSelect.mockClear();
  });

  it("opens the skill's own Markdown as a preview", async () => {
    await renderWorkspace();

    expect(screen.getByText(`Open file: ${SKILL_MD_KEY}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Skill body')).not.toBeInTheDocument();
  });

  it('closes an untouched editor without asking', async () => {
    await renderWorkspace();

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: /Close/ }));

    expect(question()).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Skill body')).not.toBeInTheDocument();
  });

  it('asks before Close drops unsaved edits, and keeps them when told to', async () => {
    await renderWorkspace();
    await editBody();

    await userEvent.click(screen.getByRole('button', { name: /Close/ }));
    expect(question()).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).not.toBeInTheDocument());
    expect(body()).toHaveValue('# Commits!');
  });

  it('drops the edits and returns to the preview on Discard', async () => {
    await renderWorkspace();
    await editBody();

    await userEvent.click(screen.getByRole('button', { name: /Close/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(screen.queryByLabelText('Skill body')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(body()).toHaveValue('# Commits');
  });

  it('holds a move to another page until the edits are discarded', async () => {
    await renderWorkspace();
    await editBody();

    await userEvent.click(screen.getByRole('button', { name: 'Go elsewhere' }));
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(screen.queryByText('Another page')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(question()).not.toBeInTheDocument());
    expect(body()).toHaveValue('# Commits!');

    await userEvent.click(screen.getByRole('button', { name: 'Go elsewhere' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(await screen.findByText('Another page')).toBeInTheDocument();
  });

  it('moves to another page freely when nothing is unsaved', async () => {
    await renderWorkspace();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));

    await userEvent.click(screen.getByRole('button', { name: 'Go elsewhere' }));

    expect(await screen.findByText('Another page')).toBeInTheDocument();
  });

  it('asks before the tab closes only while edits are unsaved', async () => {
    const closeTab = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    await renderWorkspace();
    expect(closeTab()).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(closeTab()).toBe(false);

    await userEvent.type(body(), '!');
    expect(closeTab()).toBe(true);
  });

  it('opens a supporting Markdown file with an editor of its own', async () => {
    await renderWorkspace();

    await userEvent.click(screen.getByRole('button', { name: 'Open notes' }));
    expect(screen.getByText('Open file: docs/notes.md')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'docs/notes.md' })).toHaveValue('# Notes');
  });

  it('shows a file that is not Markdown without an Edit button', async () => {
    await renderWorkspace();

    await userEvent.click(screen.getByRole('button', { name: 'Open logo' }));

    expect(screen.getByText('Open file: logo.png')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
  });

  it('shows a skill linked to a git source without an Edit button', async () => {
    await renderWorkspace(LINKED);

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it("falls back to the skill's Markdown when the open file is no longer there", async () => {
    await renderWorkspace(SKILL, 'docs/gone.md');

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(undefined));
    expect(screen.getByText(`Open file: ${SKILL_MD_KEY}`)).toBeInTheDocument();
  });

  it('keeps the open file open when it, or a folder above it, is moved', async () => {
    await renderWorkspace(SKILL, 'docs/notes.md');

    await userEvent.click(screen.getByRole('button', { name: 'Ask to move docs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Docs moved' }));

    await waitFor(() => expect(screen.getByText('Open file: reference/notes.md')).toBeInTheDocument());
    expect(onSelect).not.toHaveBeenCalledWith(undefined);
  });

  it("falls back to the skill's Markdown when a move that was asked for did not happen", async () => {
    await renderWorkspace(SKILL, 'docs/notes.md');

    await userEvent.click(screen.getByRole('button', { name: 'Ask to move docs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Files deleted' }));

    await waitFor(() => expect(screen.getByText(`Open file: ${SKILL_MD_KEY}`)).toBeInTheDocument());
  });
});
