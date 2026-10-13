import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aSkill } from '@/test/fixtures';
import * as api from './api';
import {
  queryKeys,
  useDeleteSkillFile,
  useMoveSkillPath,
  useReloadConfig,
  useSkill,
  useSkillFileContent,
  useSkills,
  useUpdateSkill,
} from './queries';

vi.mock('./api', () => ({
  reloadConfig: vi.fn(async () => ({ reloaded: true, skillCount: 2, workspaceCount: 1 })),
  listSkills: vi.fn(async () => []),
  getSkill: vi.fn(),
  readSkillFile: vi.fn(async () => ({ content: 'text', binary: false, size: 4 })),
  moveSkillPath: vi.fn(),
  deleteSkillFile: vi.fn(),
  updateSkill: vi.fn(),
}));

const NOTES = { path: 'notes.md', type: 'file', size: 4 } as const;
const GUIDE = { path: 'guide.md', type: 'file', size: 4 } as const;
const DEMO = aSkill({ name: 'demo', files: [NOTES, GUIDE] });

/** A query client and the wrapper that hands it to the hooks under test. */
function aClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.mocked(api.getSkill).mockReset().mockResolvedValue(DEMO);
  vi.mocked(api.readSkillFile).mockClear();
  vi.mocked(api.listSkills).mockClear();
});

describe('useReloadConfig', () => {
  it('marks every cached resource stale once the server has reloaded', async () => {
    const queryClient = new QueryClient();
    const cached = [queryKeys.status, queryKeys.settings, queryKeys.skill('demo'), queryKeys.workspaces];
    for (const key of cached) {
      queryClient.setQueryData(key, {});
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useReloadConfig(), { wrapper });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({ skillCount: 2, workspaceCount: 1 });
    expect(cached.map((key) => queryClient.getQueryState(key)?.isInvalidated)).toEqual([true, true, true, true]);
  });
});

describe('a change to a skill’s files', () => {
  /** The skill page as it is while two files are open: the list, the skill, both files, and the two mutations. */
  function useOpenFiles() {
    return {
      list: useSkills(),
      skill: useSkill('demo'),
      notes: useSkillFileContent('demo', 'notes.md'),
      guide: useSkillFileContent('demo', 'guide.md'),
      move: useMoveSkillPath('demo'),
      remove: useDeleteSkillFile('demo'),
    };
  }

  /** Renders the open files and waits until every one has loaded, then forgets the calls that took. */
  async function openFiles() {
    const { wrapper } = aClient();
    const { result } = renderHook(useOpenFiles, { wrapper });
    await waitFor(() => expect(result.current.guide.isSuccess && result.current.notes.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.list.isSuccess && result.current.skill.isSuccess).toBe(true));
    vi.mocked(api.readSkillFile).mockClear();
    vi.mocked(api.listSkills).mockClear();
    return result;
  }

  it('refetches the list and the files still there, not the file that was moved', async () => {
    vi.mocked(api.moveSkillPath).mockResolvedValue(aSkill({ ...DEMO, files: [{ ...NOTES, path: 'moved.md' }, GUIDE] }));
    const result = await openFiles();

    await result.current.move.mutateAsync({ from: 'notes.md', to: 'moved.md' });

    await waitFor(() => expect(api.readSkillFile).toHaveBeenCalledWith('demo', 'guide.md'));
    await waitFor(() => expect(api.listSkills).toHaveBeenCalled());
    expect(api.readSkillFile).not.toHaveBeenCalledWith('demo', 'notes.md');
  });

  it('does not refetch the file that was deleted', async () => {
    vi.mocked(api.deleteSkillFile).mockResolvedValue(aSkill({ ...DEMO, files: [GUIDE] }));
    const result = await openFiles();

    await result.current.remove.mutateAsync('notes.md');

    await waitFor(() => expect(api.readSkillFile).toHaveBeenCalledWith('demo', 'guide.md'));
    expect(api.readSkillFile).not.toHaveBeenCalledWith('demo', 'notes.md');
  });
});

describe('useUpdateSkill', () => {
  /** The skill page as it is while a skill and one of its files are open, with the mutation that patches it. */
  function useOpenSkill() {
    return {
      list: useSkills(),
      skill: useSkill('demo'),
      notes: useSkillFileContent('demo', 'notes.md'),
      update: useUpdateSkill('demo'),
    };
  }

  /** Renders the open skill and waits until it has loaded, then forgets the calls that took. */
  async function openSkill() {
    const { queryClient, wrapper } = aClient();
    const { result } = renderHook(useOpenSkill, { wrapper });
    await waitFor(() => expect(result.current.skill.isSuccess && result.current.notes.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    for (const mock of [api.getSkill, api.readSkillFile, api.listSkills]) {
      vi.mocked(mock).mockClear();
    }
    return { queryClient, result };
  }

  it('caches a renamed skill under its new name and asks nothing more of the old one', async () => {
    const renamed = aSkill({ ...DEMO, name: 'renamed' });
    vi.mocked(api.updateSkill).mockResolvedValue(renamed);
    const { queryClient, result } = await openSkill();

    await result.current.update.mutateAsync({ name: 'renamed' });

    await waitFor(() => expect(api.listSkills).toHaveBeenCalled());
    expect(queryClient.getQueryData(queryKeys.skill('renamed'))).toEqual(renamed);
    expect(api.getSkill).not.toHaveBeenCalledWith('demo');
    expect(api.readSkillFile).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(queryKeys.skill('demo'))?.isInvalidated).toBe(true);
  });

  it('refetches the skill and its open file after a change that keeps the name', async () => {
    vi.mocked(api.updateSkill).mockResolvedValue(aSkill({ ...DEMO, description: 'New' }));
    const { result } = await openSkill();

    await result.current.update.mutateAsync({ description: 'New' });

    await waitFor(() => expect(api.getSkill).toHaveBeenCalledWith('demo'));
    await waitFor(() => expect(api.readSkillFile).toHaveBeenCalledWith('demo', 'notes.md'));
    await waitFor(() => expect(api.listSkills).toHaveBeenCalled());
  });
});
