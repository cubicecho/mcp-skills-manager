import type {
  CreateSkillFolderRequest,
  CreateSkillRequest,
  CreateWorkspaceRequest,
  ImportSkillRequest,
  MoveSkillPathRequest,
  UpdateSettingsRequest,
  UpdateSkillRequest,
  UpdateWorkspaceRequest,
  WriteSkillFileRequest,
} from '@mcp-skills/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

/** TanStack Query keys for every cached API resource. */
export const queryKeys = {
  status: ['status'] as const,
  settings: ['settings'] as const,
  skills: ['skills'] as const,
  skill: (name: string) => ['skills', name] as const,
  workspaces: ['workspaces'] as const,
  workspace: (slug: string) => ['workspaces', slug] as const,
};

/**
 * Polls the server status every 15 seconds.
 * @returns The status query.
 */
export function useServerStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: api.getStatus,
    refetchInterval: 15_000,
  });
}

/**
 * Reads the token-free settings.
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
 * @returns The skill-summaries query.
 */
export function useSkills() {
  return useQuery({
    queryKey: queryKeys.skills,
    queryFn: api.listSkills,
    refetchInterval: 10_000,
  });
}

/**
 * Reads one skill with its body.
 * @param name Skill slug.
 * @returns The skill-detail query.
 */
export function useSkill(name: string) {
  return useQuery({
    queryKey: queryKeys.skill(name),
    queryFn: () => api.getSkill(name),
  });
}

/** Read one supporting file's content; disabled until a path is selected. */
export function useSkillFileContent(name: string, filePath: string | null) {
  return useQuery({
    queryKey: [...queryKeys.skill(name), 'file', filePath],
    queryFn: () => api.readSkillFile(name, filePath as string),
    enabled: filePath != null,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Polls the workspace list every 10 seconds.
 * @returns The workspaces query.
 */
export function useWorkspaces() {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: api.listWorkspaces,
    refetchInterval: 10_000,
  });
}

/**
 * Patches the settings and refreshes the status.
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
 * Creates a skill and caches its detail.
 * @returns The mutation.
 */
export function useCreateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSkillRequest) => api.createSkill(body),
    onSuccess: (skill) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      queryClient.setQueryData(queryKeys.skill(skill.name), skill);
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    },
  });
}

/**
 * Imports an uploaded skill and caches its detail.
 * @returns The mutation.
 */
export function useImportSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportSkillRequest) => api.importSkill(body),
    onSuccess: (skill) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      queryClient.setQueryData(queryKeys.skill(skill.name), skill);
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    },
  });
}

/** Add/replace a supporting file on a skill; may promote a `file` skill to a `dir`. */
export function useWriteSkillFile(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: WriteSkillFileRequest) => api.writeSkillFile(name, body),
    onSuccess: (skill) => {
      queryClient.setQueryData(queryKeys.skill(name), skill);
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

/**
 * Creates an empty folder inside a skill.
 * @param name Skill slug.
 * @returns The mutation.
 */
export function useCreateSkillFolder(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSkillFolderRequest) => api.createSkillFolder(name, body),
    onSuccess: (skill) => {
      queryClient.setQueryData(queryKeys.skill(name), skill);
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

/**
 * Renames or moves a file or folder inside a skill.
 * @param name Skill slug.
 * @returns The mutation.
 */
export function useMoveSkillPath(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MoveSkillPathRequest) => api.moveSkillPath(name, body),
    onSuccess: (skill) => {
      queryClient.setQueryData(queryKeys.skill(name), skill);
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

/**
 * Deletes a file or folder inside a skill.
 * @param name Skill slug.
 * @returns The mutation.
 */
export function useDeleteSkillFile(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filePath: string) => api.deleteSkillFile(name, filePath),
    onSuccess: (skill) => {
      queryClient.setQueryData(queryKeys.skill(name), skill);
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

/**
 * Patches a skill; a rename moves its cache entry to the new name.
 * @param name Current skill slug.
 * @returns The mutation.
 */
export function useUpdateSkill(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSkillRequest) => api.updateSkill(name, body),
    onSuccess: (skill) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      queryClient.invalidateQueries({ queryKey: queryKeys.skill(name) });
      queryClient.setQueryData(queryKeys.skill(skill.name), skill);
    },
  });
}

/**
 * Deletes a skill and refreshes the lists that showed it.
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
 * @param slug Current workspace slug.
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
