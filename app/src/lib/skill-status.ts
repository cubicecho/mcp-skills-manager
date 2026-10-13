import type { SkillSummary } from '@mcp-skills/shared';
import type { LucideIcon } from 'lucide-react';
import { GitBranch, Layers } from '@/components/app-icons';
import { Lock } from '@/components/ui/icons';

/** The facts about a skill that are worth a mark beside its name, most restrictive first. */
export const SKILL_STATUS = {
  linked: { label: 'Git', hint: 'Synced from a git repo', icon: GitBranch },
  readOnly: { label: 'Read-only', hint: 'Read-only for agents', icon: Lock },
  scoped: { label: 'Workspace-scoped', hint: 'Hidden from the root /mcp endpoint', icon: Layers },
} as const satisfies Record<string, { label: string; hint: string; icon: LucideIcon }>;

/** The key of one status fact in `SKILL_STATUS`. */
export type SkillStatusKey = keyof typeof SKILL_STATUS;

/**
 * Lists the status facts that hold for a skill.
 *
 * @param skill - The skill to describe.
 * @returns The facts' keys, in the order of `SKILL_STATUS`.
 */
export function skillStatuses(skill: Pick<SkillSummary, 'source' | 'readOnly' | 'global'>): SkillStatusKey[] {
  const holds: Record<SkillStatusKey, boolean> = {
    linked: skill.source !== undefined,
    readOnly: skill.readOnly,
    scoped: skill.global === false,
  };
  return Object.keys(SKILL_STATUS)
    .filter((key): key is SkillStatusKey => key in holds)
    .filter((key) => holds[key]);
}
