import type { SkillToolMode } from '@mcp-skills/shared';
import { createFileRoute } from '@tanstack/react-router';
import { RefreshCwIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { reloadConfig } from '@/lib/api';
import { useServerStatus, useSettings, useUpdateSettings } from '@/lib/queries';
import { SKILL_TOOL_MODE_HINTS, SKILL_TOOL_MODE_LABELS, SKILL_TOOL_MODES } from '@/lib/skill-tool-mode';
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

function SkillToolModeCard() {
  const { data: settings, isPending } = useSettings();
  const updateSettings = useUpdateSettings();

  const onChange = (value: string) => {
    updateSettings.mutate(
      { skillToolMode: value as SkillToolMode },
      {
        onSuccess: () => toast.success('MCP tool exposure updated'),
        onError: toastApiError,
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">MCP tool exposure</CardTitle>
        <CardDescription>
          How skills are advertised as tools on the root <code>/mcp</code> endpoint. Profiles can override this per
          endpoint. Skills are always reachable as <code>skill://</code> resources regardless.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isPending && <Skeleton className="h-9 w-64" />}
        {settings && (
          <>
            <Select value={settings.skillToolMode} onValueChange={onChange} disabled={updateSettings.isPending}>
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SKILL_TOOL_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {SKILL_TOOL_MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{SKILL_TOOL_MODE_HINTS[settings.skillToolMode]}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AuthoringCard() {
  const { data: settings, isPending } = useSettings();
  const updateSettings = useUpdateSettings();

  const onChange = (authoringEnabled: boolean) => {
    updateSettings.mutate(
      { authoringEnabled },
      {
        onSuccess: () =>
          toast.success(
            authoringEnabled ? 'Agent authoring enabled' : 'Agent authoring disabled — endpoints read-only',
          ),
        onError: toastApiError,
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Agent authoring</CardTitle>
        <CardDescription>
          Let agents create and edit skills over MCP (the <code>create_skill</code>, <code>update_skill</code>,{' '}
          <code>write_skill_file</code>, … tools). Turn off to make every <code>/mcp</code> endpoint read-only. Writes
          always stay behind the same bearer auth.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending && <Skeleton className="h-6 w-40" />}
        {settings && (
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <span className="text-sm font-medium">Allow agents to author skills</span>
              <p className="text-xs text-muted-foreground">
                {settings.authoringEnabled
                  ? 'Authoring tools are exposed on every endpoint.'
                  : 'Endpoints are read-only.'}
              </p>
            </div>
            <Switch
              checked={settings.authoringEnabled}
              disabled={updateSettings.isPending}
              onCheckedChange={onChange}
              aria-label="Allow agents to author skills"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LiveUpdatesCard() {
  const { data: settings, isPending } = useSettings();
  const updateSettings = useUpdateSettings();

  const onChange = (httpLiveUpdates: boolean) => {
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
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">HTTP live updates</CardTitle>
        <CardDescription>
          Push resource change notifications (<code>resources/list_changed</code> and <code>resources/updated</code>) to
          subscribed HTTP clients over SSE. This runs <code>/mcp</code> in stateful mode, keeping a session per client.
          Off keeps <code>/mcp</code> stateless (clients re-poll). Live updates over stdio are always on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending && <Skeleton className="h-6 w-40" />}
        {settings && (
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <span className="text-sm font-medium">Push live updates over HTTP</span>
              <p className="text-xs text-muted-foreground">
                {settings.httpLiveUpdates
                  ? 'Stateful sessions with SSE push are enabled on /mcp.'
                  : '/mcp is stateless; clients re-poll resources/list.'}
              </p>
            </div>
            <Switch
              checked={settings.httpLiveUpdates}
              disabled={updateSettings.isPending}
              onCheckedChange={onChange}
              aria-label="Push live updates over HTTP"
            />
          </div>
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
      toast.success(`Reloaded: ${result.skillCount} skills, ${result.profileCount} profiles`);
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
              <Row label="Profiles" value={String(data.profileCount)} />
              <Row label="Auth" value={data.authEnabled ? 'bearer token' : 'disabled'} />
            </div>
          )}
        </CardContent>
      </Card>

      <SkillToolModeCard />

      <AuthoringCard />

      <LiveUpdatesCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reload from disk</CardTitle>
          <CardDescription>
            Skills and profiles are hand-editable flat files under <code>DATA_DIR</code>. Edits are picked up
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
            <code>{`# all skills\nmcp-skills-stdio --data-dir /path/to/data\n\n# only a profile's skills\nmcp-skills-stdio --data-dir /path/to/data --profile backend`}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
