import { createFileRoute } from '@tanstack/react-router';
import { RefreshCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { reloadConfig } from '@/lib/api';
import { useServerStatus, useSettings, useUpdateSettings } from '@/lib/queries';
import { SKILL_TOOL_MODE_HINTS } from '@/lib/skill-tool-mode';
import { toastApiError } from '@/lib/toast';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}

/** One toggle option — the shared inner row used by every switch on this page. */
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
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <div className="pr-3">
        <span className="text-sm font-medium">{label}</span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

function McpOptionsCard() {
  const { data: settings, isPending } = useSettings();
  const updateSettings = useUpdateSettings();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">MCP options</CardTitle>
        <CardDescription>
          How the <code>/mcp</code> endpoints behave. Workspaces can override tool exposure per endpoint, and every
          setting stays behind the same bearer auth.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isPending && (
          <>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </>
        )}
        {settings && (
          <>
            <ToggleRow
              label="One tool per skill"
              description={SKILL_TOOL_MODE_HINTS[settings.skillToolMode]}
              checked={settings.skillToolMode === 'per-skill'}
              disabled={updateSettings.isPending}
              onCheckedChange={(checked) =>
                updateSettings.mutate(
                  { skillToolMode: checked ? 'per-skill' : 'loader' },
                  { onSuccess: () => toast.success('MCP tool exposure updated'), onError: toastApiError },
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
                    onError: toastApiError,
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
                    onError: toastApiError,
                  },
                )
              }
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsPage() {
  const { data, isPending } = useServerStatus();

  const reload = async () => {
    try {
      const result = await reloadConfig();
      toast.success(`Reloaded: ${result.skillCount} skills, ${result.workspaceCount} workspaces`);
    } catch (error) {
      toastApiError(error);
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Server status and configuration.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent>
          {isPending && <Skeleton className="h-24 w-full" />}
          {data && (
            <div className="flex flex-col">
              <Row label="Version" value={data.version} />
              <Row label="Port" value={String(data.port)} />
              <Row label="Uptime" value={`${data.uptimeSeconds}s`} />
              <Row label="Skills" value={String(data.skillCount)} />
              <Row label="Workspaces" value={String(data.workspaceCount)} />
              <Row label="Auth" value={data.authEnabled ? 'bearer token' : 'disabled'} />
            </div>
          )}
        </CardContent>
      </Card>

      <McpOptionsCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reload from disk</CardTitle>
          <CardDescription>
            Skills and workspaces are hand-editable flat files under <code>DATA_DIR</code>. Edits are picked up
            automatically, but you can force an immediate re-read here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={reload}>
            <RefreshCwIcon /> Reload config
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect over stdio</CardTitle>
          <CardDescription>Run the server as a stdio MCP process instead of HTTP.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 text-xs">
            <code>{`# all skills\nmcp-skills-stdio --data-dir /path/to/data\n\n# only a workspace's skills\nmcp-skills-stdio --data-dir /path/to/data --workspace backend`}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
