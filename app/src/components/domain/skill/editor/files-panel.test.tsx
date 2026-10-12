import type { SkillDetail } from '@mcp-skills/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SKILL_MD_KEY } from './file-tree';
import { FilesPanel } from './files-panel';

type MutateOptions = { onSuccess?: () => void };
const writeFile = vi.fn(async (_input: unknown) => ({}));
const createFolder = vi.fn(async (_input: unknown) => ({}));
const movePath = vi.fn(async (_input: unknown) => ({}));
const deleteFile = vi.fn((_path: string, options?: MutateOptions) => options?.onSuccess?.());
const syncSkill = vi.fn();
const exportSkill = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), apiError: vi.fn() };

vi.mock('@/lib/queries', () => ({
  useWriteSkillFile: () => ({ mutateAsync: writeFile, isPending: false }),
  useCreateSkillFolder: () => ({ mutateAsync: createFolder, isPending: false }),
  useMoveSkillPath: () => ({ mutateAsync: movePath, isPending: false }),
  useDeleteSkillFile: () => ({ mutate: deleteFile, isPending: false }),
  useSyncSkill: () => ({ mutate: syncSkill, isPending: false }),
  useLinkSkillSource: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSkill: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  exportSkill: (name: string) => exportSkill(name),
}));

vi.mock('@/lib/toast', () => ({ useToasts: () => toast }));

const SKILL = {
  name: 'pdf-forms',
  description: '',
  body: '# Forms',
  tags: [],
  format: 'dir',
  path: 'pdf-forms/SKILL.md',
  global: true,
  readOnly: false,
  files: [
    { path: 'docs', type: 'dir', size: 0 },
    { path: 'docs/notes.md', type: 'file', size: 1536 },
    { path: 'logo.png', type: 'file', size: 12 },
  ],
  frontmatter: {},
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as SkillDetail;

const LINKED = {
  ...SKILL,
  source: { repo: 'https://github.com/o/r', commit: 'abc1234', syncedAt: '2026-01-01T00:00:00.000Z' },
} as unknown as SkillDetail;

const FILE_SKILL = { ...SKILL, format: 'file', path: 'pdf-forms.md', files: [] } as unknown as SkillDetail;

const onSelect = vi.fn();

function renderPanel(skill: SkillDetail = SKILL, selected: string = SKILL_MD_KEY) {
  return render(<FilesPanel skill={skill} selected={selected} onSelect={onSelect} onRenamed={() => {}} />);
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const queryButton = (name: string | RegExp) => screen.queryByRole('button', { name });
const files = () => within(screen.getByLabelText('Skill files'));

/** Answer the open path prompt and submit it. */
async function answerPrompt(label: string, value: string, submit: string) {
  const field = screen.getByLabelText(new RegExp(`^${label}`));
  await userEvent.clear(field);
  await userEvent.type(field, value);
  await userEvent.click(button(submit));
}

describe('FilesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts the skill’s own Markdown among its files, and says where they live', () => {
    renderPanel();

    expect(screen.getByText(/3 files under/)).toHaveTextContent('3 files under skills/pdf-forms/');
  });

  it('says where a file skill lives', () => {
    renderPanel(FILE_SKILL);

    expect(screen.getByText(/1 file under/)).toHaveTextContent('1 file under skills/pdf-forms.md');
  });

  it('offers every content action on a skill that is not linked', () => {
    renderPanel();

    for (const name of ['New file', 'New folder', 'Add files', 'Add folder', 'Export .zip', 'Rename skill']) {
      expect(button(name)).toBeInTheDocument();
    }
    expect(button('Link to Git source')).toBeInTheDocument();
    expect(queryButton('Sync from Git')).not.toBeInTheDocument();
  });

  it('offers a linked skill only Sync, Export and Rename, with no row actions', async () => {
    renderPanel(LINKED);

    for (const name of ['New file', 'New folder', 'Add files', 'Add folder', 'Link to Git source']) {
      expect(queryButton(name)).not.toBeInTheDocument();
    }
    expect(button('Export .zip')).toBeInTheDocument();
    expect(button('Rename skill')).toBeInTheDocument();
    expect(queryButton(/^Rename docs/)).not.toBeInTheDocument();
    expect(queryButton(/^Delete /)).not.toBeInTheDocument();

    await userEvent.click(button('Sync from Git'));
    expect(syncSkill).toHaveBeenCalledTimes(1);
  });

  it('pins the skill’s own Markdown first, marked main and with no row actions', async () => {
    renderPanel();

    const rows = files().getAllByRole('button', { name: /^(SKILL\.md|notes\.md|logo\.png)/ });
    expect(rows[0]).toHaveTextContent('SKILL.md');
    expect(rows[0]).toHaveTextContent('main');
    expect(queryButton('Rename SKILL.md')).not.toBeInTheDocument();
    expect(queryButton('Delete SKILL.md')).not.toBeInTheDocument();

    await userEvent.click(rows[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(SKILL_MD_KEY);
  });

  it('pins a file skill’s Markdown under its file name', () => {
    renderPanel(FILE_SKILL);

    expect(files().getByRole('button', { name: /^pdf-forms\.md/ })).toHaveAttribute('aria-current', 'true');
  });

  it('shows each file’s size and opens the one pressed', async () => {
    renderPanel(SKILL, 'docs/notes.md');

    const notes = files().getByRole('button', { name: /^notes\.md/ });
    expect(notes).toHaveTextContent('1.5 KB');
    expect(notes).toHaveAttribute('aria-current', 'true');

    await userEvent.click(files().getByRole('button', { name: /^logo\.png/ }));
    expect(onSelect).toHaveBeenCalledWith('logo.png');
  });

  it('creates an empty Markdown file and opens it in the editor', async () => {
    renderPanel();

    await userEvent.click(button('New file'));
    await answerPrompt('Path', '/guides/intro.md/', 'Create file');

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('guides/intro.md', { edit: true }));
    expect(writeFile).toHaveBeenCalledWith({ path: 'guides/intro.md', content: '', encoding: 'utf8' });
  });

  it('opens a new file that is not Markdown as a preview', async () => {
    renderPanel();

    await userEvent.click(button('New file'));
    await answerPrompt('Path', 'data.json', 'Create file');

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('data.json', { edit: false }));
  });

  it('keeps the prompt open and opens nothing when the file cannot be created', async () => {
    writeFile.mockRejectedValueOnce(new Error('exists'));
    renderPanel();

    await userEvent.click(button('New file'));
    await answerPrompt('Path', 'docs/notes.md', 'Create file');

    await waitFor(() => expect(toast.apiError).toHaveBeenCalledTimes(1));
    expect(onSelect).not.toHaveBeenCalled();
    expect(button('Create file')).toBeInTheDocument();
  });

  it('creates a file or a folder inside the folder whose row asked', async () => {
    renderPanel();

    await userEvent.click(button('New file in docs'));
    expect(screen.getByText(/Created under/)).toHaveTextContent('Created under docs/.');
    await answerPrompt('Path', 'intro.md', 'Create file');
    await waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith({ path: 'docs/intro.md', content: '', encoding: 'utf8' }),
    );

    await userEvent.click(button('New folder in docs'));
    await answerPrompt('Name', 'examples', 'Create folder');
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith({ path: 'docs/examples' }));
  });

  it('creates a folder at the skill root', async () => {
    renderPanel();

    await userEvent.click(button('New folder'));
    await answerPrompt('Path', 'reference/examples', 'Create folder');

    await waitFor(() => expect(createFolder).toHaveBeenCalledWith({ path: 'reference/examples' }));
  });

  it('renames a file by moving it to the path given', async () => {
    renderPanel();

    await userEvent.click(button('Rename docs/notes.md'));
    expect(screen.getByLabelText(/^Path/)).toHaveValue('docs/notes.md');
    await answerPrompt('Path', 'reference/notes.md', 'Rename');

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Renamed to reference/notes.md'));
    expect(movePath).toHaveBeenCalledWith({ from: 'docs/notes.md', to: 'reference/notes.md' });
  });

  it('deletes a file only once the question is confirmed', async () => {
    renderPanel();

    await userEvent.click(button('Delete logo.png'));
    expect(screen.getByText('Delete file "logo.png"?')).toBeInTheDocument();
    expect(deleteFile).not.toHaveBeenCalled();

    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(deleteFile.mock.calls[0]?.[0]).toBe('logo.png');
    expect(toast.success).toHaveBeenCalledWith('Deleted logo.png');
  });

  it('warns that deleting a folder takes its files with it', async () => {
    renderPanel();

    await userEvent.click(button('Delete docs'));

    expect(screen.getByText('Delete folder "docs"?')).toBeInTheDocument();
    expect(screen.getByText(/Every file inside the folder is deleted with it/)).toBeInTheDocument();
  });

  it('downloads the export as <name>.zip', async () => {
    const downloads: string[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:export', revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    exportSkill.mockResolvedValue(new Blob(['zip']));
    renderPanel();

    await userEvent.click(button('Export .zip'));

    await waitFor(() => expect(downloads).toEqual(['pdf-forms.zip']));
    expect(exportSkill).toHaveBeenCalledWith('pdf-forms');
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('reports an export that fails', async () => {
    const failure = new Error('offline');
    exportSkill.mockRejectedValue(failure);
    renderPanel();

    await userEvent.click(button('Export .zip'));

    await waitFor(() => expect(toast.apiError).toHaveBeenCalledWith(failure));
  });
});
