import type { SkillDetail } from '@mcp-skills/shared';
import { useSkillFlags } from '@/components/domain/skill/use-skill-flags';
import { ToggleRow } from '@/components/domain/toggle-row';
import { Code } from '@/components/ui/code';

/**
 * A skill's local settings: whether the root endpoint serves it and whether agents may change it.
 * They are this server's, not the content's, so they stay switchable on a skill linked to a git source.
 * @param props.skill - The skill the switches belong to.
 */
export function SkillFlags({ skill }: { skill: SkillDetail }) {
  const flags = useSkillFlags(skill.name);

  return (
    <>
      <ToggleRow
        title={
          <>
            Serve on root <Code>/mcp</Code>
          </>
        }
        description={
          <>
            On: every client of the root endpoint gets this skill. Off: workspace-scoped — hidden from root{' '}
            <Code>/mcp</Code>, served only on workspaces that list it (frontmatter <Code>global: false</Code>).
          </>
        }
        checked={skill.global}
        disabled={flags.isPending}
        onCheckedChange={flags.setGlobal}
      />
      <ToggleRow
        title="Read-only for agents"
        description={
          skill.source ? (
            <>
              Agents can never modify a skill linked to a git source. On, this stays in force after the skill is
              unlinked (frontmatter <Code>readonly: true</Code>).
            </>
          ) : (
            <>
              On: agents can still load this skill, but the MCP authoring tools refuse to edit, rename or delete it or
              {skill.format === 'dir' ? ' anything in its folder' : ' attach files to it'} (frontmatter{' '}
              <Code>readonly: true</Code>). You can still edit it here.
            </>
          )
        }
        checked={skill.readOnly}
        disabled={flags.isPending}
        onCheckedChange={flags.setReadOnly}
      />
    </>
  );
}
