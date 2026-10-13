import type {
  ApiError,
  CreateSkillFolderRequest,
  CreateSkillRequest,
  CreateWorkspaceRequest,
  GitSource,
  ImportGitSkillRequest,
  ImportSkillRequest,
  MoveSkillPathRequest,
  ServerStatus,
  SettingsView,
  SkillDetail,
  SkillFileRead,
  SkillSummary,
  SyncSkillResponse,
  UpdateSettingsRequest,
  UpdateSkillRequest,
  UpdateWorkspaceRequest,
  WorkspaceStatus,
  WriteSkillFileRequest,
} from '@mcp-skills/shared';
import { HttpStatus } from '@mcp-skills/shared';
import { getToken, requireAuth } from './auth';

/** Non-2xx responses throw this; carries the HTTP status and the server's { error, detail? } envelope. */
export class ApiRequestError extends Error {
  /** HTTP status of the response. */
  readonly status: number;
  /** The envelope's `detail`, when the server sent one. */
  readonly detail?: string;

  /**
   * Builds the error for one failed response.
   *
   * @param status - HTTP status of the response.
   * @param message - The envelope's `error`, or the status text.
   * @param [detail] - The envelope's `detail`.
   */
  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.detail = detail;
  }
}

/** Fetch options `authorizedFetch` accepts; headers are a plain record so they can be merged. */
interface AuthorizedInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Method and JSON body of one API call. */
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/**
 * Builds the REST path of one skill.
 *
 * @param name - Skill slug; URL-encoded here.
 * @returns The path, e.g. `/api/skills/my-skill`, to append sub-resources to.
 */
function skillUrl(name: string): string {
  return `/api/skills/${encodeURIComponent(name)}`;
}

/**
 * Fetches with the stored bearer token attached, raising the needs-auth flag on a 401.
 *
 * @param path - Request path.
 * @param [init] - Fetch options; its headers are merged over the Authorization header.
 * @returns The response, whatever its status.
 */
async function authorizedFetch(path: string, init: AuthorizedInit = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(path, { ...init, headers: { ...headers, ...init.headers } });
  if (response.status === HttpStatus.Unauthorized) {
    requireAuth();
  }
  return response;
}

/**
 * Makes one JSON API call.
 *
 * @typeParam T - The shape of the response body; not checked at run time.
 * @param path - Request path.
 * @param [options] - Method and JSON body.
 * @returns The parsed body, or undefined when it is empty. Throws `ApiRequestError` on a non-2xx response.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await authorizedFetch(path, {
    method: options.method ?? 'GET',
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

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

/**
 * GET /api/status.
 *
 * @returns Version, uptime, counts and auth state.
 */
export function getStatus(): Promise<ServerStatus> {
  return request('/api/status');
}

/**
 * GET /api/settings.
 *
 * @returns The settings without the auth token.
 */
export function getSettings(): Promise<SettingsView> {
  return request('/api/settings');
}

/**
 * PATCH /api/settings.
 *
 * @param body - Settings to change.
 * @returns The updated settings.
 */
export function updateSettings(body: UpdateSettingsRequest): Promise<SettingsView> {
  return request('/api/settings', { method: 'PATCH', body });
}

/**
 * GET /api/skills.
 *
 * @returns Every skill, without bodies.
 */
export function listSkills(): Promise<SkillSummary[]> {
  return request('/api/skills');
}

/**
 * GET /api/skills/:name.
 *
 * @param name - Skill slug.
 * @returns The skill with its body.
 */
export function getSkill(name: string): Promise<SkillDetail> {
  return request(skillUrl(name));
}

/**
 * POST /api/skills.
 *
 * @param body - Skill to create.
 * @returns The created skill.
 */
export function createSkill(body: CreateSkillRequest): Promise<SkillDetail> {
  return request('/api/skills', { method: 'POST', body });
}

/**
 * POST /api/skills/import.
 *
 * @param body - Uploaded files, normalized by skill-upload.
 * @returns The created skill.
 */
export function importSkill(body: ImportSkillRequest): Promise<SkillDetail> {
  return request('/api/skills/import', { method: 'POST', body });
}

/**
 * POST /api/skills/import-git.
 *
 * @param body - Repo, ref and folder to fetch, plus an optional local skill id.
 * @returns The created skill, linked to its source.
 */
export function importGitSkill(body: ImportGitSkillRequest): Promise<SkillDetail> {
  return request('/api/skills/import-git', { method: 'POST', body });
}

/**
 * PUT /api/skills/:name/source: links a skill to a git source and replaces its content from it.
 *
 * @param name - Skill slug.
 * @param body - Repo, ref and folder to fetch.
 * @returns The skill as synced.
 */
export function linkSkillSource(name: string, body: GitSource): Promise<SkillDetail> {
  return request(`${skillUrl(name)}/source`, { method: 'PUT', body });
}

/**
 * DELETE /api/skills/:name/source: drops the link, keeping the content.
 *
 * @param name - Skill slug.
 * @returns The skill, editable again.
 */
export function unlinkSkillSource(name: string): Promise<SkillDetail> {
  return request(`${skillUrl(name)}/source`, { method: 'DELETE' });
}

/**
 * POST /api/skills/:name/sync: refetches a linked skill from its git source.
 *
 * @param name - Skill slug.
 * @returns The skill as synced, and whether the source had moved on.
 */
export function syncSkill(name: string): Promise<SyncSkillResponse> {
  return request(`${skillUrl(name)}/sync`, { method: 'POST' });
}

/**
 * PUT /api/skills/:name/files.
 *
 * @param name - Skill slug.
 * @param body - File path and content.
 * @returns The skill with its updated file list.
 */
export function writeSkillFile(name: string, body: WriteSkillFileRequest): Promise<SkillDetail> {
  return request(`${skillUrl(name)}/files`, { method: 'PUT', body });
}

/**
 * GET /api/skills/:name/files/content.
 *
 * @param name - Skill slug.
 * @param filePath - File path relative to the skill root.
 * @returns The file content, base64 when binary.
 */
export function readSkillFile(name: string, filePath: string): Promise<SkillFileRead> {
  return request(`${skillUrl(name)}/files/content?path=${encodeURIComponent(filePath)}`);
}

/**
 * POST /api/skills/:name/folders.
 *
 * @param name - Skill slug.
 * @param body - Folder path.
 * @returns The skill with its updated file list.
 */
export function createSkillFolder(name: string, body: CreateSkillFolderRequest): Promise<SkillDetail> {
  return request(`${skillUrl(name)}/folders`, { method: 'POST', body });
}

/**
 * POST /api/skills/:name/files/move.
 *
 * @param name - Skill slug.
 * @param body - Source and destination paths.
 * @returns The skill with its updated file list.
 */
export function moveSkillPath(name: string, body: MoveSkillPathRequest): Promise<SkillDetail> {
  return request(`${skillUrl(name)}/files/move`, { method: 'POST', body });
}

/**
 * DELETE /api/skills/:name/files.
 *
 * @param name - Skill slug.
 * @param filePath - File or folder path relative to the skill root.
 * @returns The skill with its updated file list.
 */
export function deleteSkillFile(name: string, filePath: string): Promise<SkillDetail> {
  return request(`${skillUrl(name)}/files?path=${encodeURIComponent(filePath)}`, {
    method: 'DELETE',
  });
}

/**
 * GET /api/skills/:name/export: fetches a skill's .zip export with the bearer token attached.
 *
 * @param name - Skill slug.
 * @returns The archive, for the caller to offer as a download. Throws `ApiRequestError` on a non-2xx response.
 */
export async function exportSkill(name: string): Promise<Blob> {
  const response = await authorizedFetch(`${skillUrl(name)}/export`);
  if (!response.ok) {
    throw new ApiRequestError(response.status, response.statusText || `Export failed (${response.status})`);
  }
  return response.blob();
}

/**
 * PATCH /api/skills/:name.
 *
 * @param name - Current skill slug.
 * @param body - Fields to change.
 * @returns The updated skill.
 */
export function updateSkill(name: string, body: UpdateSkillRequest): Promise<SkillDetail> {
  return request(skillUrl(name), { method: 'PATCH', body });
}

/**
 * DELETE /api/skills/:name.
 *
 * @param name - Skill slug.
 */
export function deleteSkill(name: string): Promise<void> {
  return request(skillUrl(name), { method: 'DELETE' });
}

/**
 * GET /api/workspaces.
 *
 * @returns Every workspace.
 */
export function listWorkspaces(): Promise<WorkspaceStatus[]> {
  return request('/api/workspaces');
}

/**
 * GET /api/workspaces/:slug.
 *
 * @param slug - Workspace slug.
 * @returns The workspace.
 */
export function getWorkspace(slug: string): Promise<WorkspaceStatus> {
  return request(`/api/workspaces/${encodeURIComponent(slug)}`);
}

/**
 * POST /api/workspaces.
 *
 * @param body - Workspace to create.
 * @returns The created workspace.
 */
export function createWorkspace(body: CreateWorkspaceRequest): Promise<WorkspaceStatus> {
  return request('/api/workspaces', { method: 'POST', body });
}

/**
 * PATCH /api/workspaces/:slug.
 *
 * @param slug - Current workspace slug.
 * @param body - Fields to change.
 * @returns The updated workspace.
 */
export function updateWorkspace(slug: string, body: UpdateWorkspaceRequest): Promise<WorkspaceStatus> {
  return request(`/api/workspaces/${encodeURIComponent(slug)}`, { method: 'PATCH', body });
}

/**
 * DELETE /api/workspaces/:slug.
 *
 * @param slug - Workspace slug.
 */
export function deleteWorkspace(slug: string): Promise<void> {
  return request(`/api/workspaces/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

/**
 * POST /api/reload: re-reads DATA_DIR from disk.
 *
 * @returns The counts after the reload.
 */
export function reloadConfig(): Promise<{ reloaded: boolean; skillCount: number; workspaceCount: number }> {
  return request('/api/reload', { method: 'POST' });
}
