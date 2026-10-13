import type { SkillSummary } from '@mcp-skills/shared';

/** The scope filter's choices, with the label each shows. */
export const SCOPE_LABELS = { all: 'All scopes', global: 'Global', scoped: 'Workspace-scoped' } as const;
/** One choice of the scope filter. */
export type ScopeFilter = keyof typeof SCOPE_LABELS;

/** The format filter's choices, with the label each shows. */
export const FORMAT_LABELS = { all: 'All formats', dir: 'Directory', file: 'File' } as const;
/** One choice of the format filter. */
export type FormatFilter = keyof typeof FORMAT_LABELS;

/** The sort orders, with the label each shows. */
export const SORT_LABELS = { name: 'Name (A–Z)', updated: 'Recently updated', used: 'Most used' } as const;
/** One of the sort orders. */
export type SortKey = keyof typeof SORT_LABELS;

/** What the skills page narrows its list by, and the order it shows the rest in. */
export interface SkillListFilters {
  /** Text looked for in a skill's name, description and tags, whatever its case. */
  query: string;
  scope: ScopeFilter;
  format: FormatFilter;
  /** The tag a skill must carry; `undefined` for any. */
  tag: string | undefined;
  sort: SortKey;
}

/** Every skill, by name: the list as the page first shows it. */
export const NO_FILTERS: SkillListFilters = { query: '', scope: 'all', format: 'all', tag: undefined, sort: 'name' };

/**
 * Narrows the skill list to what the filters allow and orders it.
 *
 * @param skills - The full list; not mutated.
 * @param filters - The search text, scope, format, tag and sort order to apply.
 * @returns The matching skills, sorted.
 */
export function filterAndSort(skills: SkillSummary[], filters: SkillListFilters): SkillSummary[] {
  const { query, scope, format, tag, sort } = filters;
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

/**
 * Collects the distinct tags across the skill list.
 *
 * @param skills - The skills whose tags to gather.
 * @returns Each tag once, sorted, so the filter dropdown keeps a stable order.
 */
export function collectTags(skills: SkillSummary[]): string[] {
  return [...new Set(skills.flatMap((skill) => skill.tags))].sort((a, b) => a.localeCompare(b));
}
