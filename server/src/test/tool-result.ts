/**
 * The text of a tool result's first content block.
 * @param res - What a tool call returned.
 * @returns The block's text.
 */
export function firstText(res: unknown): string {
  const block = (res as { content?: Array<{ type: string; text: string }> }).content?.[0];
  if (!block) {
    throw new Error('tool result had no content');
  }
  return block.text;
}
