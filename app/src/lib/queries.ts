import type {
  CreateProfileRequest,
  CreateSkillRequest,
  UpdateProfileRequest,
  UpdateSkillRequest,
} from '@mcp-skills/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export const queryKeys = {
  status: ['status'] as const,
  skills: ['skills'] as const,
  skill: (name: string) => ['skills', name] as const,
  profiles: ['profiles'] as const,
  profile: (slug: string) => ['profiles', slug] as const,
};

// --- queries ---

export function useServerStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: api.getStatus,
    refetchInterval: 15_000,
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

export function useProfiles() {
  return useQuery({
    queryKey: queryKeys.profiles,
    queryFn: api.listProfiles,
    refetchInterval: 10_000,
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
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    },
  });
}

// --- profile mutations ---

export function useCreateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProfileRequest) => api.createProfile(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    },
  });
}

export function useUpdateProfile(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) => api.updateProfile(slug, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
    },
  });
}

export function useDeleteProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.deleteProfile(slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    },
  });
}
