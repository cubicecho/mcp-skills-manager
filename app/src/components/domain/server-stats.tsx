import { Skeleton } from '@/components/ui/skeleton';
import { formatCount, formatDuration } from '@/lib/format';
import { useServerStatus, useSkills } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** What the server is serving, at the foot of the sidebar: the figures every page wants to know. */
export function ServerStats() {
  const status = useServerStatus();
  const { data: skills } = useSkills();
  const { data } = status;

  if (status.isPending) {
    return <Skeleton className="mx-2 my-1.5 h-12" />;
  }

  // How often any skill has been loaded over MCP; left off until the skill list has arrived.
  const loads = skills?.reduce((sum, skill) => sum + skill.usage.count, 0);

  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5 text-xs">
      <output className="flex items-center gap-1.5 font-medium">
        <span aria-hidden className={cn('size-1.5 rounded-full', data ? 'bg-primary' : 'bg-destructive')} />
        {data ? `Serving ${formatCount(data.skillCount, 'skill')}` : 'Server unreachable'}
      </output>
      {data && (
        <>
          <p className="text-muted-foreground">
            {formatCount(data.workspaceCount, 'workspace')}
            {loads !== undefined && ` · ${formatCount(loads, 'load')}`}
          </p>
          <p className="truncate text-muted-foreground">
            v{data.version} · up {formatDuration(data.uptimeSeconds)}
          </p>
        </>
      )}
    </div>
  );
}
