/** Sentinel selection value for the skill's own Markdown (its `<name>.md` / `SKILL.md`). */
export const SKILL_MD_KEY = '\0skill-md';

/**
 * Tell whether a path names a Markdown file, which is the only kind editable in the web UI.
 * @param path - The file path to test.
 * @returns True when the path ends in `.md`, in any case.
 */
export const isMarkdownPath = (path: string): boolean => /\.md$/i.test(path);
