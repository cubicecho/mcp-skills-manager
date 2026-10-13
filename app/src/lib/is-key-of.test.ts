import { describe, expect, it } from 'vitest';
import { isKeyOf } from './is-key-of';

describe('isKeyOf', () => {
  const LABELS = { name: 'Name', used: 'Most used' } as const;

  it('accepts the table’s own keys', () => {
    expect(isKeyOf(LABELS, 'name')).toBe(true);
    expect(isKeyOf(LABELS, 'used')).toBe(true);
  });

  it('refuses any other string, inherited property names included', () => {
    expect(isKeyOf(LABELS, 'updated')).toBe(false);
    expect(isKeyOf(LABELS, 'toString')).toBe(false);
    expect(isKeyOf(LABELS, '')).toBe(false);
  });
});
