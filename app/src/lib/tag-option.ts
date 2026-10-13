/** The select value meaning "no tag filter". Tag options carry a prefix, so no tag can equal it. */
export const ANY_TAG_OPTION = 'any';

/** What every tag's select value starts with. */
const TAG_OPTION_PREFIX = 'tag:';

/**
 * Turns a tag filter into a select value that `ANY_TAG_OPTION` cannot collide with.
 *
 * @param tag - The tag filtered on, or undefined for no tag filter.
 * @returns The value to give the select.
 */
export function tagToOption(tag: string | undefined): string {
  return tag === undefined ? ANY_TAG_OPTION : `${TAG_OPTION_PREFIX}${tag}`;
}

/**
 * Reads a tag filter back from a select value made by {@link tagToOption}.
 *
 * @param option - The selected value.
 * @returns The tag to filter on, or undefined for no tag filter.
 */
export function optionToTag(option: string): string | undefined {
  return option.startsWith(TAG_OPTION_PREFIX) ? option.slice(TAG_OPTION_PREFIX.length) : undefined;
}
