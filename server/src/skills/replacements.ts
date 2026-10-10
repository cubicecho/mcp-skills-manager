import { HttpError } from '../errors.ts';

/** One change to part of a text: an exact passage, and the text that takes its place. */
export interface Replacement {
  oldText: string;
  /** Empty to delete the passage. */
  newText: string;
  /** Replace every occurrence of `oldText`, where otherwise it must occur exactly once. */
  replaceAll?: boolean;
}

/**
 * Makes each replacement in order, each on the result of the one before. Line endings are
 * compared as `\n`, and the result has `\n`.
 * @param text - The text to change.
 * @param replacements - The passages to swap, in the order they are made.
 * @returns The new text, and `replaced`: how many passages were swapped.
 * @throws HttpError 400 for a replacement that changes nothing, 404 for a passage the text does
 *   not have, and 409 for one it has more than once without `replaceAll`.
 */
export function applyReplacements(text: string, replacements: Replacement[]): { text: string; replaced: number } {
  let next = withUnixNewlines(text);
  let replaced = 0;
  for (const [index, replacement] of replacements.entries()) {
    const which = `edit ${index + 1} of ${replacements.length}`;
    const oldText = withUnixNewlines(replacement.oldText);
    const newText = withUnixNewlines(replacement.newText);
    if (oldText === newText) {
      throw new HttpError(400, `${which}: old_text and new_text are the same, so nothing was written`);
    }

    const pieces = next.split(oldText);
    const occurrences = pieces.length - 1;
    if (occurrences === 0) {
      const isFirstEdit = index === 0;
      throw new HttpError(
        404,
        `${which}: old_text is not in the text, so nothing was written. ${howToFix(next, oldText, isFirstEdit)}`,
      );
    }
    const isAmbiguous = occurrences > 1 && replacement.replaceAll !== true;
    if (isAmbiguous) {
      throw new HttpError(
        409,
        `${which}: old_text is in the text ${occurrences} times, so nothing was written. ` +
          'Add the text around the one you mean until it matches once, or pass replace_all: true',
      );
    }

    next = pieces.join(newText);
    replaced += occurrences;
  }
  return { text: next, replaced };
}

/** A passage of a text, with the 1-based, inclusive lines it is on. */
interface Passage {
  start: number;
  end: number;
  text: string;
}

/**
 * What to tell an agent whose `oldText` matched nothing: the nearest passage when there is one, so
 * the text need not be read again.
 * @param text - The text that was searched.
 * @param oldText - The passage that was not found.
 * @param linesAreAsStored - False once an earlier edit has moved the lines, so none are named.
 * @returns The sentence that ends the refusal.
 */
function howToFix(text: string, oldText: string, linesAreAsStored: boolean): string {
  const nearest = nearestPassage(text, oldText);
  if (!nearest) {
    return 'It must match character for character, whitespace included: read the text again and copy the passage from it';
  }
  const lines = linesAreAsStored ? ` (lines ${nearest.start}-${nearest.end})` : '';
  return `The nearest passage${lines} follows; copy old_text from it exactly:\n${nearest.text}`;
}

/**
 * Finds the passage of `text` an `oldText` that matched nothing most likely meant: the one that
 * differs from it only in whitespace, or else the lines from the one `oldText` starts with.
 * @param text - The text that was searched.
 * @param oldText - The passage that was not found.
 * @returns The nearest passage, or `undefined` when nothing in the text resembles `oldText`.
 */
function nearestPassage(text: string, oldText: string): Passage | undefined {
  const words = oldText.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return undefined;
  }
  const spacedAnyhow = new RegExp(words.map(escapeRegExp).join('\\s+')).exec(text);
  if (spacedAnyhow) {
    const start = text.slice(0, spacedAnyhow.index).split('\n').length;
    const end = start + spacedAnyhow[0].split('\n').length - 1;
    return { start, end, text: spacedAnyhow[0] };
  }

  const oldLines = oldText.trim().split('\n');
  const firstLine = (oldLines[0] ?? '').trim();
  const lines = text.split('\n');
  const first = lines.findIndex((line) => line.trim() === firstLine);
  if (first === -1) {
    return undefined;
  }
  const passage = lines.slice(first, first + oldLines.length);
  return { start: first + 1, end: first + passage.length, text: passage.join('\n') };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withUnixNewlines(text: string): string {
  return text.replaceAll('\r\n', '\n');
}
