import { z } from 'zod';

/**
 * Schemas for a skill's git source: the folder in a git repo a skill is linked
 * to and synced from. The link is stored under the `source` key of the skill's
 * frontmatter, so it stays hand-editable alongside the rest of the skill.
 */

/** `user@host:path`, git's scp-like SSH syntax. */
const SCP_LIKE_REPO = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:\S+$/;

/**
 * Tells whether a repo URL is one the server will clone: https or SSH only, and
 * no credentials in an https URL — the URL is written into SKILL.md and served to agents.
 * @param repo Repo URL to test.
 * @returns True when the URL is acceptable.
 */
function isAllowedRepo(repo: string): boolean {
  if (SCP_LIKE_REPO.test(repo)) {
    return true;
  }
  let url: URL;
  try {
    url = new URL(repo);
  } catch {
    return false;
  }
  if (url.protocol === 'ssh:') {
    return url.password === '';
  }
  return url.protocol === 'https:' && url.username === '' && url.password === '';
}

/**
 * Tells whether a folder path stays inside the repo.
 * @param folder Folder path to test.
 * @returns True for a relative path with no `..` segment or backslash.
 */
function isRepoRelative(folder: string): boolean {
  return !folder.includes('\\') && !folder.split('/').includes('..');
}

/** Where to fetch a skill from: a repo, plus an optional ref and folder. Body of PUT /api/skills/:name/source. */
export const gitSourceSchema = z.object({
  /** Clone URL: `https://…`, `ssh://…` or `user@host:path`. */
  repo: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine(isAllowedRepo, 'must be an https:// or SSH git URL without embedded credentials'),
  /** Branch or tag to track; the repo's default branch when absent. */
  ref: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^\s-]\S*$/, 'must be a branch or tag name')
    .optional(),
  /** Folder inside the repo holding the SKILL.md; the repo root when absent. */
  path: z
    .string()
    .trim()
    .max(1024)
    .refine(isRepoRelative, 'must be a folder path inside the repo')
    .transform((folder) => folder.replace(/^\/+|\/+$/g, ''))
    .pipe(z.string().min(1))
    .optional(),
});
export type GitSource = z.infer<typeof gitSourceSchema>;

/** A skill's stored link: the source plus what the last sync fetched. */
export const skillSourceSchema = gitSourceSchema.extend({
  /** Commit the skill's files were last synced from. */
  commit: z.string().optional(),
  /** ISO 8601 time of the last sync. */
  syncedAt: z.string().optional(),
});
export type SkillSource = z.infer<typeof skillSourceSchema>;

/** Path segments that separate the repo from the ref in a forge's folder URL. */
const TREE_MARKERS = ['tree', 'blob'];

/**
 * Splits a pasted forge folder URL into the parts of a source, so
 * `https://github.com/<owner>/<repo>/tree/<ref>/<folder>` (or GitLab's `/-/tree/`)
 * fills repo, ref and folder at once. The first segment after `tree/` is taken as
 * the ref, so a ref containing `/` needs correcting by hand.
 * @param input Whatever was pasted into the repo field.
 * @returns The parts found; anything that is not a folder URL comes back as the repo alone.
 */
export function parseGitSourceUrl(input: string): { repo: string; ref?: string; path?: string } {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { repo: trimmed };
  }
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const marker = segments.findIndex((segment, index) => index >= 2 && TREE_MARKERS.includes(segment));
  const ref = segments[marker + 1];
  if (url.protocol !== 'https:' || marker === -1 || !ref) {
    return { repo: trimmed.replace(/\/+$/, '') };
  }
  const repoSegments = segments.slice(0, marker).filter((segment) => segment !== '-');
  const folder = segments.slice(marker + 2).join('/');
  return {
    repo: `${url.origin}/${repoSegments.join('/')}`,
    ref,
    ...(folder ? { path: folder } : {}),
  };
}
