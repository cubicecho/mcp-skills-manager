import type { SkillSummary } from '@mcp-skills/shared';

/** The scope filter's choices, with the label each shows. */
export const SCOPE_LABELS = { all: 'All scopes', global: 'Global', scoped: 'Workspace-scoped' } as const;
export type ScopeFilter = keyof typeof SCOPE_LABELS;

/** The format filter's choices, with the label each shows. */
export const FORMAT_LABELS = { all: 'All formats', dir: 'Directory', file: 'File' } as const;
export type FormatFilter = keyof typeof FORMAT_LABELS;

/** The sort orders, with the label each shows. */
export const SORT_LABELS = { name: 'Name (A–Z)', updated: 'Recently updated', used: 'Most used' } as const;
export type SortKey = keyof typeof SORT_LABELS;

/** Apply the search query, scope/format/tag filters and sort to the raw skill list. */
export function filterAndSort(
  skills: SkillSummary[],
  query: string,
  scope: ScopeFilter,
  format: FormatFilter,
  tag: string | undefined,
  sort: SortKey,
): SkillSummary[] {
  const q = query.trim().toLowerCase();
  const matched = skills.filter((skill) => {
    if (scope === 'global' && !skill.global) {
      return false;
    }
    if (scope === 'scoped' && skill.global) {
      return false;
    }
    if (format !== 'all' && skill.format !== format) {
      return false;
    }
    if (tag !== undefined && skill.tags.includes(tag) === false) {
      return false;
    }
    const searched = `${skill.name} ${skill.description} ${skill.tags.join(' ')}`.toLowerCase();
    if (q && searched.includes(q) === false) {
      return false;
    }
    return true;
  });
  return matched.sort((a, b) => {
    if (sort === 'updated') {
      return b.updatedAt.localeCompare(a.updatedAt);
    }
    if (sort === 'used') {
      return b.usage.count - a.usage.count || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });
}

/** All distinct tags across the skill list, sorted for a stable filter dropdown. */
export function collectTags(skills: SkillSummary[]): string[] {
  return [...new Set(skills.flatMap((skill) => skill.tags))].sort((a, b) => a.localeCompare(b));
}
