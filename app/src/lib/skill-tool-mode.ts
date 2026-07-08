import type { SkillToolMode } from '@mcp-skills/shared';

/** Short labels for each skill-tool mode, shared by the settings page and the profile override select. */
export const SKILL_TOOL_MODE_LABELS: Record<SkillToolMode, string> = {
  'per-skill': 'One tool per skill',
  loader: 'Single load_skill tool',
};

/** One-line explanation of each mode's trade-off, shown under the settings select. */
export const SKILL_TOOL_MODE_HINTS: Record<SkillToolMode, string> = {
  'per-skill': 'Each skill is its own MCP tool — most discoverable, but every skill loads into the client’s tool list.',
  loader: 'A single load_skill(name) tool plus list_skills — fixed tool footprint, leaner context for big catalogues.',
};
