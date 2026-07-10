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

export const queryKeys = {
  status: ['status'] as const,
  settings: ['settings'] as const,
  skills: ['skills'] as const,
  skill: (name: string) => ['skills', name] as const,
  workspaces: ['workspaces'] as const,
  workspace: (slug: string) => ['workspaces', slug] as const,
};

// --- queries ---

export function useServerStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: api.getStatus,
    refetchInterval: 15_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: api.getSettings,
  });
}

export function useSkills() {
  return useQuery({
    queryKey: queryKeys.skills,
    queryFn: api.listSkills,
    refetchInterval: 10_000,
  });
}

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

export function useWorkspaces() {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: api.listWorkspaces,
    refetchInterval: 10_000,
  });
}

// --- settings mutations ---

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

// --- skill mutations ---

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

// --- workspace mutations ---

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

export function useUpdateWorkspace(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateWorkspaceRequest) => api.updateWorkspace(slug, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

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
