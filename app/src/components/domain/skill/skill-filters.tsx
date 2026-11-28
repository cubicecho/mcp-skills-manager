import type { SelectEntry } from '@/components/app-form';
import { Combobox } from '@/components/combobox';
import { FilterBar } from '@/components/filter-bar';
import { SearchInput } from '@/components/ui/search-input';
import { isKeyOf } from '@/lib/is-key-of';
import { FORMAT_LABELS, SCOPE_LABELS, type SkillListFilters, SORT_LABELS } from '@/lib/skill-list';
import { ANY_TAG_OPTION, optionToTag, tagToOption } from '@/lib/tag-option';

/**
 * Lists a label table as select options, in the table's order.
 *
 * @param labels - Label by option value.
 * @returns One option per entry.
 */
function toOptions(labels: Readonly<Record<string, string>>): SelectEntry[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

const SCOPE_OPTIONS = toOptions(SCOPE_LABELS);
const FORMAT_OPTIONS = toOptions(FORMAT_LABELS);
const SORT_OPTIONS = toOptions(SORT_LABELS);

/**
 * The skills page's filter bar: its search box, its scope, format, tag and sort selects, and Clear filters while
 * one narrows the list.
 *
 * @returns The bar to put over the list.
 */
export function SkillFilters({
  filters,
  tags,
  onChange,
  status,
  isFiltered,
  onClear,
}: {
  /** The filters as they stand. */
  filters: SkillListFilters;
  /** Every tag a skill carries; the tag select is left out when there are none. */
  tags: string[];
  /** Called with the filters that differ, to merge into the rest. */
  onChange: (change: Partial<SkillListFilters>) => void;
  /** What the filters leave, such as "2 of 5 skills"; left out while nothing is filtered. */
  status: string | undefined;
  /** Whether any filter narrows the list, which is when Clear filters shows. */
  isFiltered: boolean;
  /** Puts every filter back, keeping the sort order. */
  onClear: () => void;
}) {
  const controls = (
    <>
      <SearchInput
        wrapperClassName="w-64"
        label="Search skills"
        placeholder="Search name or description…"
        value={filters.query}
        onChangeText={(query) => onChange({ query })}
      />
      <Combobox
        className="w-40"
        aria-label="Filter by scope"
        options={SCOPE_OPTIONS}
        value={filters.scope}
        onValueChange={(scope) => {
          if (isKeyOf(SCOPE_LABELS, scope)) {
            onChange({ scope });
          }
        }}
      />
      <Combobox
        className="w-40"
        aria-label="Filter by format"
        options={FORMAT_OPTIONS}
        value={filters.format}
        onValueChange={(format) => {
          if (isKeyOf(FORMAT_LABELS, format)) {
            onChange({ format });
          }
        }}
      />
      {tags.length > 0 && (
        <Combobox
          className="w-40"
          aria-label="Filter by tag"
          options={[
            { value: ANY_TAG_OPTION, label: 'All tags' },
            ...tags.map((tag) => ({ value: tagToOption(tag), label: tag })),
          ]}
          value={tagToOption(filters.tag)}
          onValueChange={(option) => onChange({ tag: optionToTag(option) })}
        />
      )}
      <Combobox
        className="w-40"
        aria-label="Sort skills"
        options={SORT_OPTIONS}
        value={filters.sort}
        onValueChange={(sort) => {
          if (isKeyOf(SORT_LABELS, sort)) {
            onChange({ sort });
          }
        }}
      />
    </>
  );

  return <FilterBar contentSlot={controls} status={status} isFiltered={isFiltered} onClear={onClear} />;
}
