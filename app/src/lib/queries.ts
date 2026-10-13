import type {
  CreateSkillFolderRequest,
  CreateSkillRequest,
  CreateWorkspaceRequest,
  GitSource,
  ImportGitSkillRequest,
  ImportSkillRequest,
  MoveSkillPathRequest,
  SkillDetail,
  UpdateSettingsRequest,
  UpdateSkillRequest,
  UpdateWorkspaceRequest,
  WriteSkillFileRequest,
} from '@mcp-skills/shared';
import { type QueryClient, type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import { POLLING_DEFAULTS } from './defaults';

/** TanStack Query keys for every cached API resource. */
export const queryKeys = {
  status: ['status'] as const,
  settings: ['settings'] as const,
  skills: ['skills'] as const,
  skill: (name: string) => ['skills', name] as const,
  skillFile: (name: string, filePath: string | null) => ['skills', name, 'file', filePath] as const,
  workspaces: ['workspaces'] as const,
  workspace: (slug: string) => ['workspaces', slug] as const,
};

/**
 * Caches a just-created skill and refreshes the lists and counts that now include it.
 *
 * @param queryClient - The query client holding the cache.
 * @param skill - The skill the server returned.
 */
function cacheNewSkill(queryClient: QueryClient, skill: SkillDetail): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.skills });
  queryClient.setQueryData(queryKeys.skill(skill.name), skill);
  queryClient.invalidateQueries({ queryKey: queryKeys.status });
}

/**
 * Tells whether a query holds a file the skill no longer has, which the server would answer with a 404.
 *
 * @param key - The query's key.
 * @param name - The slug the skill is cached under.
 * @param skill - The skill as the server last returned it.
 * @returns True for a file-content query of this skill whose path is not among the skill's files.
 */
function isGoneFile(key: QueryKey, name: string, skill: SkillDetail): boolean {
  const [, owner, kind, filePath] = key;
  return owner === name && kind === 'file' && skill.files.some((file) => file.path === filePath) === false;
}

/**
 * Caches a skill whose supporting files changed, and refreshes its open files and the skill list, which
 * shows file counts.
 *
 * @remarks
 * A file the change moved or deleted may still be on screen for a moment; it is left alone, not refetched.
 *
 * @param queryClient - The query client holding the cache.
 * @param name - The slug the skill is cached under.
 * @param skill - The skill the server returned.
 */
function cacheSkillAfterFileChange(queryClient: QueryClient, name: string, skill: SkillDetail): void {
  queryClient.setQueryData(queryKeys.skill(name), skill);
  queryClient.invalidateQueries({
    queryKey: queryKeys.skills,
    predicate: (query) => isGoneFile(query.queryKey, name, skill) === false,
  });
}

/**
 * Caches a skill whose whole folder was replaced from (or cut loose from) its git source: every
 * cached file of it is stale, and the lists show its link.
 *
 * @param queryClient - The query client holding the cache.
 * @param name - The slug the skill is cached under.
 * @param skill - The skill the server returned.
 */
function cacheSkillAfterSourceChange(queryClient: QueryClient, name: string, skill: SkillDetail): void {
  queryClient.setQueryData(queryKeys.skill(name), skill);
  queryClient.invalidateQueries({ queryKey: queryKeys.skill(name) });
  queryClient.invalidateQueries({ queryKey: queryKeys.skills });
}

/**
 * Polls the server status every 15 seconds.
 *
 * @returns The status query.
 */
export function useServerStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: api.getStatus,
    refetchInterval: POLLING_DEFAULTS.statusMs,
  });
}

/**
 * Reads the token-free settings.
 *
 * @returns The settings query.
 */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: api.getSettings,
  });
}

/**
 * Polls the skill list every 10 seconds.
 *
 * @returns The skill-summaries query.
 */
export function useSkills() {
  return useQuery({
    queryKey: queryKeys.skills,
    queryFn: api.listSkills,
    refetchInterval: POLLING_DEFAULTS.listMs,
  });
}

/**
 * Reads one skill with its body.
 *
 * @param name - Skill slug.
 * @returns The skill-detail query.
 */
export function useSkill(name: string) {
  return useQuery({
    queryKey: queryKeys.skill(name),
    queryFn: () => api.getSkill(name),
  });
}

/**
 * Reads one supporting file's content, uncached, so it is fetched afresh each time it is opened.
 *
 * @param name - Skill slug.
 * @param filePath - File path relative to the skill root; null leaves the query disabled.
 * @returns The file-content query.
 */
export function useSkillFileContent(name: string, filePath: string | null) {
  return useQuery({
    queryKey: queryKeys.skillFile(name, filePath),
    // Only runs once a path is selected (`enabled`).
    queryFn: () => api.readSkillFile(name, filePath ?? ''),
    enabled: filePath != null,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Polls the workspace list every 10 seconds.
 *
 * @returns The workspaces query.
 */
export function useWorkspaces() {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: api.listWorkspaces,
    refetchInterval: POLLING_DEFAULTS.listMs,
  });
}

/**
 * Patches the settings and refreshes the status.
 *
 * @returns The mutation.
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsRequest) => api.updateSettings(body),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    },
  });
}

/**
 * Asks the server to re-read its files, then marks every cached resource stale: a reload can change any of them.
 *
 * @returns The mutation, resolving to the reloaded skill and workspace counts.
 */
export function useReloadConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.reloadConfig(),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}

/**
 * Creates a skill and caches its detail.
 *
 * @returns The mutation.
 */
export function useCreateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSkillRequest) => api.createSkill(body),
    onSuccess: (skill) => cacheNewSkill(queryClient, skill),
  });
}

/**
 * Imports an uploaded skill and caches its detail.
 *
 * @returns The mutation.
 */
export function useImportSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportSkillRequest) => api.importSkill(body),
    onSuccess: (skill) => cacheNewSkill(queryClient, skill),
  });
}

/**
 * Imports a skill from a folder in a git repo and caches its detail.
 *
 * @returns The mutation.
 */
export function useImportGitSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportGitSkillRequest) => api.importGitSkill(body),
    onSuccess: (skill) => cacheNewSkill(queryClient, skill),
  });
}

/**
 * Links a skill to a git source, replacing its content from it.
 *
 * @param name - Skill slug.
 * @returns The mutation.
 */
export function useLinkSkillSource(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GitSource) => api.linkSkillSource(name, body),
    onSuccess: (skill) => cacheSkillAfterSourceChange(queryClient, name, skill),
  });
}

/**
 * Drops a skill's git link, keeping its content.
 *
 * @param name - Skill slug.
 * @returns The mutation.
 */
export function useUnlinkSkillSource(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.unlinkSkillSource(name),
    onSuccess: (skill) => cacheSkillAfterSourceChange(queryClient, name, skill),
  });
}

/**
 * Refetches a linked skill from its git source.
 *
 * @param name - Skill slug.
 * @returns The mutation; it resolves with the skill and whether the source had moved on.
 */
export function useSyncSkill(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.syncSkill(name),
    onSuccess: ({ skill }) => cacheSkillAfterSourceChange(queryClient, name, skill),
  });
}

/**
 * Adds or replaces a supporting file on a skill, which may promote a `file` skill to a `dir`.
 *
 * @param name - Skill slug.
 * @returns The mutation.
 */
export function useWriteSkillFile(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: WriteSkillFileRequest) => api.writeSkillFile(name, body),
    onSuccess: (skill) => cacheSkillAfterFileChange(queryClient, name, skill),
  });
}

/**
 * Creates an empty folder inside a skill.
 *
 * @param name - Skill slug.
 * @returns The mutation.
 */
export function useCreateSkillFolder(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSkillFolderRequest) => api.createSkillFolder(name, body),
    onSuccess: (skill) => cacheSkillAfterFileChange(queryClient, name, skill),
  });
}

/**
 * Renames or moves a file or folder inside a skill.
 *
 * @param name - Skill slug.
 * @returns The mutation.
 */
export function useMoveSkillPath(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MoveSkillPathRequest) => api.moveSkillPath(name, body),
    onSuccess: (skill) => cacheSkillAfterFileChange(queryClient, name, skill),
  });
}

/**
 * Deletes a file or folder inside a skill.
 *
 * @param name - Skill slug.
 * @returns The mutation.
 */
export function useDeleteSkillFile(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filePath: string) => api.deleteSkillFile(name, filePath),
    onSuccess: (skill) => cacheSkillAfterFileChange(queryClient, name, skill),
  });
}

/**
 * Patches a skill; a rename moves its cache entry to the new name.
 *
 * @remarks
 * After a rename the old name is still on screen until the page moves to the new one. Its entries are
 * marked stale but not refetched: the server no longer knows the name.
 *
 * @param name - Current skill slug.
 * @returns The mutation.
 */
export function useUpdateSkill(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSkillRequest) => api.updateSkill(name, body),
    onSuccess: (skill) => {
      queryClient.setQueryData(queryKeys.skill(skill.name), skill);
      if (skill.name === name) {
        queryClient.invalidateQueries({ queryKey: queryKeys.skills });
        return;
      }
      const [, renamed] = queryKeys.skill(name);
      queryClient.invalidateQueries({ queryKey: queryKeys.skill(name), refetchType: 'none' });
      queryClient.invalidateQueries({
        queryKey: queryKeys.skills,
        predicate: (query) => query.queryKey[1] !== renamed,
      });
    },
  });
}

/**
 * Deletes a skill and refreshes the lists that showed it.
 *
 * @returns The mutation.
 */
export function useDeleteSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteSkill(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    },
  });
}

/**
 * Creates a workspace.
 *
 * @returns The mutation.
 */
export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkspaceRequest) => api.createWorkspace(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    },
  });
}

/**
 * Patches a workspace.
 *
 * @param slug - Current workspace slug.
 * @returns The mutation.
 */
export function useUpdateWorkspace(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateWorkspaceRequest) => api.updateWorkspace(slug, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

/**
 * Deletes a workspace.
 *
 * @returns The mutation.
 */
export function useDeleteWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.deleteWorkspace(slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    },
  });
}
