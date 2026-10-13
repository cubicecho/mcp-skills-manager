/** Sentinel selection value for the skill's own Markdown (its `<name>.md` / `SKILL.md`). */
export const SKILL_MD_KEY = '\0skill-md';

/**
 * Tells whether a path names a Markdown file, which is the only kind editable in the web UI.
 *
 * @param path - The file path to test.
 * @returns True when the path ends in `.md`, in any case.
 */
export const isMarkdownPath = (path: string): boolean => /\.md$/i.test(path);

/** A file or folder moved inside a skill: the path it had and the path it has now. */
export type PathMove = { from: string; to: string };

/**
 * Finds where a path lies once a file or folder has been moved.
 *
 * @param path - The path to follow, relative to the skill root.
 * @param move - The move: the file itself, or a folder above it.
 * @returns The path's new place, or undefined when the move leaves it where it was.
 */
export function pathAfterMove(path: string, move: PathMove): string | undefined {
  if (path === move.from) {
    return move.to;
  }
  return path.startsWith(`${move.from}/`) ? `${move.to}${path.slice(move.from.length)}` : undefined;
}
