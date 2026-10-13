import { OptionSelect, type SelectEntry } from '@/components/option-select';
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

/** The skills page's search box and its scope, format, tag and sort selects. */
export function SkillFilters({
  filters,
  tags,
  onChange,
}: {
  /** The filters as they stand. */
  filters: SkillListFilters;
  /** Every tag a skill carries; the tag select is left out when there are none. */
  tags: string[];
  /** Called with the filters that differ, to merge into the rest. */
  onChange: (change: Partial<SkillListFilters>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        wrapperClassName="w-64"
        label="Search skills"
        placeholder="Search name or description…"
        value={filters.query}
        onChangeText={(query) => onChange({ query })}
      />
      <OptionSelect
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
      <OptionSelect
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
        <OptionSelect
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
      <OptionSelect
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
    </div>
  );
}
