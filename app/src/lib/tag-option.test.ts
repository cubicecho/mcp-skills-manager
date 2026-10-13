import { describe, expect, it } from 'vitest';
import { ANY_TAG_OPTION, optionToTag, tagToOption } from './tag-option';

describe('tag filter options', () => {
  it('reads "no tag filter" back as undefined', () => {
    expect(optionToTag(tagToOption(undefined))).toBeUndefined();
    expect(tagToOption(undefined)).toBe(ANY_TAG_OPTION);
  });

  it('keeps a tag apart from the "no tag filter" option, whatever it is named', () => {
    for (const tag of ['all', 'any', ANY_TAG_OPTION, 'tag:nested', 'docs']) {
      expect(tagToOption(tag)).not.toBe(ANY_TAG_OPTION);
      expect(optionToTag(tagToOption(tag))).toBe(tag);
    }
  });
});
