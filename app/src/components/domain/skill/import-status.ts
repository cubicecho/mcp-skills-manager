import { slugSchema } from '@mcp-skills/shared';

/** What the new-skill dialog needs from a tab's form to draw, and guard, the submit button it owns. */
export interface ImportStatus {
  /** What the form holds can be submitted. */
  ready: boolean;
  /** The request is in flight. */
  pending: boolean;
  /** Something has been picked or typed, so closing would lose it. */
  dirty: boolean;
}

/** A tab's form before anything is in it, and again once it is unmounted. */
export const IDLE_IMPORT: ImportStatus = { ready: false, pending: false, dirty: false };

/**
 * Checks a skill id typed into a form.
 * @param field - The field's state.
 * @param field.value - The id as typed.
 * @returns The error to show, or `undefined` for a valid slug.
 */
export function validateSkillId({ value }: { value: string }): string | undefined {
  return slugSchema.safeParse(value).success
    ? undefined
    : 'Must be a lowercase slug (letters, digits, dots, dashes, underscores).';
}
