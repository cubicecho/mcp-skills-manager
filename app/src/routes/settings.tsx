import { createFileRoute } from '@tanstack/react-router';
import { RefreshCwIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { reloadConfig } from '@/lib/api';
import { useServerStatus } from '@/lib/queries';
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
