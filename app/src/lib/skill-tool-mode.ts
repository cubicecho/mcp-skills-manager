import type { SkillToolMode } from '@mcp-skills/shared';

/** Short labels for each skill-tool mode, shared by the settings page and the profile override select. */
export const SKILL_TOOL_MODE_LABELS: Record<SkillToolMode, string> = {
  'per-skill': 'One tool per skill',
  loader: 'Single load_skill tool',
};

/**
 * The modes in display order, derived from the label map so a new mode added to
 * `SkillToolMode` forces a label (compile error) and then renders everywhere the
 * selects map over this list — no per-component `<SelectItem>` to keep in sync.
 */
export const SKILL_TOOL_MODES = Object.keys(SKILL_TOOL_MODE_LABELS) as SkillToolMode[];

/** One-line explanation of each mode's trade-off, shown under the settings select. */
export const SKILL_TOOL_MODE_HINTS: Record<SkillToolMode, string> = {
  'per-skill': 'Each skill is its own MCP tool — most discoverable, but every skill loads into the client’s tool list.',
  loader: 'A single load_skill(name) tool plus list_skills — fixed tool footprint, leaner context for big catalogues.',
};
