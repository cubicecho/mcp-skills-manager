import type { SkillDetail } from '@mcp-skills/shared';
import { SettingRow } from '@/components/setting-row';
import { Code } from '@/components/ui/code';
import { Switch } from '@/components/ui/switch';
import { useUpdateSkill } from '@/lib/queries';
import { useToasts } from '@/lib/toast';

/**
 * A skill's local settings: whether the root endpoint serves it and whether agents may change it.
 * They are this server's, not the content's, so they stay switchable on a skill linked to a git source.
 * @param props.skill - The skill the switches belong to.
 */
export function SkillFlags({ skill }: { skill: SkillDetail }) {
  const toast = useToasts();
  const visibility = useUpdateSkill(skill.name);

  const toggleGlobal = (next: boolean) => {
    visibility.mutate(
      { global: next },
      {
        onSuccess: () =>
          toast.success(next ? 'Now served on the root /mcp endpoint' : 'Now workspace-scoped — hidden from root /mcp'),
        onError: toast.apiError,
      },
    );
  };

  const toggleReadOnly = (next: boolean) => {
    visibility.mutate(
      { readOnly: next },
      {
        onSuccess: () =>
          toast.success(next ? 'Now read-only — agents can no longer modify it' : 'Agents can modify this skill again'),
        onError: toast.apiError,
      },
    );
  };

  return (
    <>
      <SettingRow
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
        action={({ titleId, descriptionId }) => (
          <Switch
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            checked={skill.global}
            disabled={visibility.isPending}
            onCheckedChange={toggleGlobal}
          />
        )}
      />
      <SettingRow
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
        action={({ titleId, descriptionId }) => (
          <Switch
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            checked={skill.readOnly}
            disabled={visibility.isPending}
            onCheckedChange={toggleReadOnly}
          />
        )}
      />
    </>
  );
}
