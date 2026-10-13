import { createFileRoute } from '@tanstack/react-router';
import { CardLayout } from '@/components/card-layout';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { ToggleRow } from '@/components/domain/toggle-row';
import { PageLayout } from '@/components/page-layout';
import { Button } from '@/components/ui/button';
import { Code, CodeBlock } from '@/components/ui/code';
import { RefreshCw } from '@/components/ui/icons';
import { formatDuration } from '@/lib/format';
import { useReloadConfig, useServerStatus, useSettings, useUpdateSettings } from '@/lib/queries';
import { SKILL_TOOL_MODE_HINTS, SKILL_TOOL_MODE_LABELS } from '@/lib/skill-tool-mode';
import { useToasts } from '@/lib/toast';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function McpOptionsCard() {
  const toast = useToasts();
  const { data: settings, isPending } = useSettings();
  const updateSettings = useUpdateSettings();

  return (
    <CardLayout
      title="MCP options"
      description={
        <>
          How the <Code>/mcp</Code> endpoints behave. Workspaces can override tool exposure per endpoint, and every
          setting stays behind the same bearer auth.
        </>
      }
      loading={isPending}
      contentClassName="flex flex-col gap-4"
      contentSlot={
        settings && (
          <>
            <ToggleRow
              title={SKILL_TOOL_MODE_LABELS['per-skill']}
              description={SKILL_TOOL_MODE_HINTS[settings.skillToolMode]}
              checked={settings.skillToolMode === 'per-skill'}
              disabled={updateSettings.isPending}
              onCheckedChange={(checked) =>
                updateSettings.mutate(
                  { skillToolMode: checked ? 'per-skill' : 'loader' },
                  { onSuccess: () => toast.success('MCP tool exposure updated'), onError: toast.apiError },
                )
              }
            />
            <ToggleRow
              title="Allow agents to author skills"
              description={
                settings.authoringEnabled
                  ? 'Authoring tools (create_skill, update_skill, …) are exposed on every endpoint.'
                  : 'Endpoints are read-only.'
              }
              checked={settings.authoringEnabled}
              disabled={updateSettings.isPending}
              onCheckedChange={(authoringEnabled) =>
                updateSettings.mutate(
                  { authoringEnabled },
                  {
                    onSuccess: () =>
                      toast.success(
                        authoringEnabled ? 'Agent authoring enabled' : 'Agent authoring disabled — endpoints read-only',
                      ),
                    onError: toast.apiError,
                  },
                )
              }
            />
            <ToggleRow
              title="Push live updates over HTTP"
              description={
                settings.httpLiveUpdates
                  ? 'Stateful sessions push resources/list_changed and resources/updated over SSE.'
                  : '/mcp is stateless; clients re-poll resources/list. Live updates over stdio are always on.'
              }
              checked={settings.httpLiveUpdates}
              disabled={updateSettings.isPending}
              onCheckedChange={(httpLiveUpdates) =>
                updateSettings.mutate(
                  { httpLiveUpdates },
                  {
                    onSuccess: () =>
                      toast.success(
                        httpLiveUpdates
                          ? 'HTTP live updates enabled — /mcp runs stateful sessions'
                          : 'HTTP live updates disabled — /mcp is stateless',
                      ),
                    onError: toast.apiError,
                  },
                )
              }
            />
          </>
        )
      }
    />
  );
}

function SettingsPage() {
  const toast = useToasts();
  const { data, isPending } = useServerStatus();

  const reloadConfig = useReloadConfig();

  const reload = () => {
    reloadConfig.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(`Reloaded: ${result.skillCount} skills, ${result.workspaceCount} workspaces`);
      },
      onError: toast.apiError,
    });
  };

  return (
    <PageLayout
      title="Settings"
      description="Server status and configuration."
      width="prose"
      contentSlot={
        <div className="flex flex-col gap-6 py-6">
          <CardLayout
            title="Status"
            loading={isPending}
            contentSlot={
              data && (
                <DescriptionList
                  contentSlot={[
                    <PropertyRow key="version" label="Version" value={data.version} />,
                    <PropertyRow key="port" label="Port" value={String(data.port)} />,
                    <PropertyRow key="uptime" label="Uptime" value={formatDuration(data.uptimeSeconds)} />,
                    <PropertyRow key="skills" label="Skills" value={String(data.skillCount)} />,
                    <PropertyRow key="workspaces" label="Workspaces" value={String(data.workspaceCount)} />,
                    <PropertyRow key="auth" label="Auth" value={data.authEnabled ? 'bearer token' : 'disabled'} />,
                  ]}
                />
              )
            }
          />

          <McpOptionsCard />

          <CardLayout
            title="Reload from disk"
            description={
              <>
                Skills and workspaces are hand-editable flat files under <Code>DATA_DIR</Code>. Edits are picked up
                automatically, but you can force an immediate re-read here.
              </>
            }
            contentSlot={<Button variant="outline" onClick={reload} content="Reload config" iconSlot={<RefreshCw />} />}
          />

          <CardLayout
            title="Connect over stdio"
            description="Run the server as a stdio MCP process instead of HTTP."
            contentSlot={
              <CodeBlock
                content={`# all skills\nmcp-skills-stdio --data-dir /path/to/data\n\n# only a workspace's skills\nmcp-skills-stdio --data-dir /path/to/data --workspace backend`}
              />
            }
          />
        </div>
      }
    />
  );
}
