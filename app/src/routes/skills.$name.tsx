import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { SkillWorkspace } from '@/components/domain/skill/editor/skill-workspace';
import { QueryError } from '@/components/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useSkill } from '@/lib/queries';

/** `edit` opens `file` in the editor, once: the page drops it as soon as the editor is open. */
type SkillSearch = { file?: string; edit?: boolean };

/**
 * One skill's files. The selected file (relative to the skill root; absent, the skill's own Markdown)
 * lives in the URL, so a preview can be linked to, reloaded, and walked back through.
 */
export const Route = createFileRoute('/skills/$name')({
  validateSearch: (search: Record<string, unknown>): SkillSearch => ({
    ...(typeof search.file === 'string' && search.file ? { file: search.file } : {}),
    ...(search.edit === true || search.edit === 'true' ? { edit: true } : {}),
  }),
  component: SkillPage,
});

function SkillPage() {
  const { name } = Route.useParams();
  const { file, edit } = Route.useSearch();
  const navigate = useNavigate();
  const skill = useSkill(name);
  const { data } = skill;

  const select = useCallback(
    (path: string | undefined, options?: { edit?: boolean }) =>
      void navigate({
        to: '/skills/$name',
        params: { name },
        search: { ...(path ? { file: path } : {}), ...(options?.edit ? { edit: true } : {}) },
      }),
    [navigate, name],
  );

  const dropEdit = useCallback(
    () =>
      void navigate({
        to: '/skills/$name',
        params: { name },
        search: ({ edit: _, ...rest }) => rest,
        replace: true,
      }),
    [navigate, name],
  );

  if (skill.isError) {
    return (
      <div className="p-6">
        <QueryError error={skill.error} onRetry={() => void skill.refetch()} what="this skill" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="h-full p-6" aria-busy>
        <Skeleton className="h-full min-h-60 w-full" />
      </div>
    );
  }
  return (
    <SkillWorkspace
      key={data.name}
      skill={data}
      selected={file}
      startEditing={edit === true}
      onSelect={select}
      onEditStarted={dropEdit}
      onRenamed={(next) => void navigate({ to: '/skills/$name', params: { name: next } })}
    />
  );
}
