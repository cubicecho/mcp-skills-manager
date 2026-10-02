import type { SkillFile } from '@mcp-skills/shared';

/** Sentinel selection value for the skill's own Markdown (its `<name>.md` / `SKILL.md`). */
export const SKILL_MD_KEY = '\0skill-md';

/**
 * Tell whether a path names a Markdown file, which is the only kind editable in the web UI.
 * @param path - The file path to test.
 * @returns True when the path ends in `.md`, in any case.
 */
export const isMarkdownPath = (path: string): boolean => /\.md$/i.test(path);

/** One file or folder in a skill's file tree, with its children nested under it. */
export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  children: TreeNode[];
}

/**
 * Build a nested tree from the flat, path-sorted entry list, synthesizing any missing parent folders.
 * @param entries - The skill's supporting files and folders.
 * @returns The root nodes, folders first and then by name at every level.
 */
export function buildTree(entries: SkillFile[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();
  const ensure = (nodePath: string, type: 'file' | 'dir', size: number): TreeNode => {
    const found = byPath.get(nodePath);
    if (found) {
      return found;
    }
    const slash = nodePath.lastIndexOf('/');
    const node: TreeNode = { name: nodePath.slice(slash + 1), path: nodePath, type, size, children: [] };
    byPath.set(nodePath, node);
    if (slash === -1) {
      roots.push(node);
    } else {
      ensure(nodePath.slice(0, slash), 'dir', 0).children.push(node);
    }
    return node;
  };
  for (const entry of entries) {
    ensure(entry.path, entry.type, entry.size);
  }
  const sortRec = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
    for (const node of nodes) {
      sortRec(node.children);
    }
  };
  sortRec(roots);
  return roots;
}
