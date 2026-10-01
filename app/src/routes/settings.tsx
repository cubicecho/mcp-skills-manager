import { createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { CardLayout } from '@/components/card-layout';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { PageLayout } from '@/components/page-layout';
import { SettingRow } from '@/components/setting-row';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { RefreshCw } from '@/components/ui/icons';
import { Switch } from '@/components/ui/switch';
import { reloadConfig } from '@/lib/api';
import { useServerStatus, useSettings, useUpdateSettings } from '@/lib/queries';
import { SKILL_TOOL_MODE_HINTS, SKILL_TOOL_MODE_LABELS } from '@/lib/skill-tool-mode';
import { useToasts } from '@/lib/toast';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

/** One toggle option — the shared row used by every switch on this page. */
function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <SettingRow
      title={label}
      description={description}
      action={({ titleId, descriptionId }) => (
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        />
      )}
    />
  );
}

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
      content={
        settings && (
          <>
            <ToggleRow
              label={SKILL_TOOL_MODE_LABELS['per-skill']}
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
              label="Allow agents to author skills"
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
              label="Push live updates over HTTP"
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

  const reload = async () => {
    try {
      const result = await reloadConfig();
      toast.success(`Reloaded: ${result.skillCount} skills, ${result.workspaceCount} workspaces`);
    } catch (error) {
      toast.apiError(error);
    }
  };

  return (
    <PageLayout
      title="Settings"
      description="Server status and configuration."
      width="prose"
      content={
        <div className="flex flex-col gap-6 py-6">
          <CardLayout
            title="Status"
            loading={isPending}
            content={
              data && (
                <DescriptionList
                  content={[
                    <PropertyRow key="version" label="Version" value={data.version} />,
                    <PropertyRow key="port" label="Port" value={String(data.port)} />,
                    <PropertyRow key="uptime" label="Uptime" value={`${data.uptimeSeconds}s`} />,
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
            content={
              <Button variant="outline" onClick={reload}>
                <RefreshCw /> Reload config
              </Button>
            }
          />

          <CardLayout
            title="Connect over stdio"
            description="Run the server as a stdio MCP process instead of HTTP."
            content={
              <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 text-xs">
                <code>{`# all skills\nmcp-skills-stdio --data-dir /path/to/data\n\n# only a workspace's skills\nmcp-skills-stdio --data-dir /path/to/data --workspace backend`}</code>
              </pre>
            }
          />
        </div>
      }
    />
  );
}
