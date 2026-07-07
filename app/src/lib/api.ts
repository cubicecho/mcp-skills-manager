import type {
  ApiError,
  CreateProfileRequest,
  CreateSkillFolderRequest,
  CreateSkillRequest,
  ImportSkillRequest,
  MoveSkillPathRequest,
  ProfileStatus,
  ServerStatus,
  SkillDetail,
  SkillFileRead,
  SkillSummary,
  UpdateProfileRequest,
  UpdateSkillRequest,
  WriteSkillFileRequest,
} from '@mcp-skills/shared';
import { getToken, requireAuth } from './auth';

/** Non-2xx responses throw this; carries the HTTP status and the server's { error, detail? } envelope. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.detail = detail;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401) {
    requireAuth();
  }

  if (!response.ok) {
    let message = response.statusText || `Request failed (${response.status})`;
    let detail: string | undefined;
    try {
      const payload = (await response.json()) as Partial<ApiError>;
      if (typeof payload.error === 'string' && payload.error.length > 0) {
        message = payload.error;
      }
      if (typeof payload.detail === 'string') {
        detail = payload.detail;
      }
    } catch {
      // non-JSON error body — keep the status text
    }
    throw new ApiRequestError(response.status, message, detail);
  }

  const text = await response.text();
  return (text.length > 0 ? JSON.parse(text) : undefined) as T;
}

// --- status ---

export function getStatus(): Promise<ServerStatus> {
  return request('/api/status');
}

// --- skills ---

export function listSkills(): Promise<SkillSummary[]> {
  return request('/api/skills');
}

export function getSkill(name: string): Promise<SkillDetail> {
  return request(`/api/skills/${encodeURIComponent(name)}`);
}

export function createSkill(body: CreateSkillRequest): Promise<SkillDetail> {
  return request('/api/skills', { method: 'POST', body });
}

export function importSkill(body: ImportSkillRequest): Promise<SkillDetail> {
  return request('/api/skills/import', { method: 'POST', body });
}

export function writeSkillFile(name: string, body: WriteSkillFileRequest): Promise<SkillDetail> {
  return request(`/api/skills/${encodeURIComponent(name)}/files`, { method: 'PUT', body });
}

export function readSkillFile(name: string, filePath: string): Promise<SkillFileRead> {
  return request(`/api/skills/${encodeURIComponent(name)}/files/content?path=${encodeURIComponent(filePath)}`);
}

export function createSkillFolder(name: string, body: CreateSkillFolderRequest): Promise<SkillDetail> {
  return request(`/api/skills/${encodeURIComponent(name)}/folders`, { method: 'POST', body });
}

export function moveSkillPath(name: string, body: MoveSkillPathRequest): Promise<SkillDetail> {
  return request(`/api/skills/${encodeURIComponent(name)}/files/move`, { method: 'POST', body });
}

export function deleteSkillFile(name: string, filePath: string): Promise<SkillDetail> {
  return request(`/api/skills/${encodeURIComponent(name)}/files?path=${encodeURIComponent(filePath)}`, {
    method: 'DELETE',
  });
}

/** Fetch a skill's .zip export (with auth) as a Blob, for the caller to trigger a download. */
export async function exportSkill(name: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`/api/skills/${encodeURIComponent(name)}/export`, { headers });
  if (response.status === 401) {
    requireAuth();
  }
  if (!response.ok) {
    throw new ApiRequestError(response.status, response.statusText || `Export failed (${response.status})`);
  }
  return response.blob();
}

export function updateSkill(name: string, body: UpdateSkillRequest): Promise<SkillDetail> {
  return request(`/api/skills/${encodeURIComponent(name)}`, { method: 'PATCH', body });
}

export function deleteSkill(name: string): Promise<void> {
  return request(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// --- profiles ---

export function listProfiles(): Promise<ProfileStatus[]> {
  return request('/api/profiles');
}

export function getProfile(slug: string): Promise<ProfileStatus> {
  return request(`/api/profiles/${encodeURIComponent(slug)}`);
}

export function createProfile(body: CreateProfileRequest): Promise<ProfileStatus> {
  return request('/api/profiles', { method: 'POST', body });
}

export function updateProfile(slug: string, body: UpdateProfileRequest): Promise<ProfileStatus> {
  return request(`/api/profiles/${encodeURIComponent(slug)}`, { method: 'PATCH', body });
}

export function deleteProfile(slug: string): Promise<void> {
  return request(`/api/profiles/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

// --- config ---

export function reloadConfig(): Promise<{ reloaded: boolean; skillCount: number; profileCount: number }> {
  return request('/api/reload', { method: 'POST' });
}
