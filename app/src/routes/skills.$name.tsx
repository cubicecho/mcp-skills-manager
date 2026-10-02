import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Lock } from '@/components/app-icons';
import { RenameButton } from '@/components/domain/skill/editor/rename-button';
import { SkillWorkspace } from '@/components/domain/skill/editor/skill-workspace';
import { PageLayout } from '@/components/page-layout';
import { QueryError } from '@/components/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { useSkill } from '@/lib/queries';

export const Route = createFileRoute('/skills/$name')({
  component: SkillEditorPage,
});

function SkillEditorPage() {
  const { name } = Route.useParams();
  const navigate = useNavigate();
  const skill = useSkill(name);
  const { data } = skill;

  return (
    <PageLayout
      breadcrumbs={
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link to="/">
            <ArrowLeft /> All skills
          </Link>
        </Button>
      }
      title={data?.name ?? name}
      description={
        data && (
          <span className="font-mono text-xs">
            {data.format === 'dir' ? `skills/${data.name}/` : `skills/${data.path}`}
          </span>
        )
      }
      loading={skill.isPending}
      action={
        data && (
          <>
            {data.readOnly && (
              <Badge variant="outline" className="gap-1 font-normal" title="Agents cannot modify this skill over MCP">
                <Lock className="size-3" /> Read-only
              </Badge>
            )}
            <RenameButton
              skill={data}
              onRenamed={(next) => navigate({ to: '/skills/$name', params: { name: next } })}
            />
          </>
        )
      }
      content={
        <div className="pb-6">
          {skill.isError ? (
            <QueryError error={skill.error} onRetry={() => void skill.refetch()} what="this skill" />
          ) : data ? (
            <SkillWorkspace key={data.name} skill={data} />
          ) : (
            <Skeleton className="h-[70vh] w-full" />
          )}
        </div>
      }
    />
  );
}
