import { File } from '@/components/app-icons';
import { FILE_TITLE } from '@/components/domain/skill/editor/editor-frame';
import { EmptyState } from '@/components/page';
import { QueryError } from '@/components/query-state';
import { Section } from '@/components/section';
import { Badge } from '@/components/ui/badge';
import { Code } from '@/components/ui/code';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { formatBytes } from '@/lib/format';
import { useSkillFileContent } from '@/lib/queries';

/** Show a non-Markdown file read-only — its contents cannot be edited here. */
export function ReadOnlyFileView({ skillName, path }: { skillName: string; path: string }) {
  const { data, isPending, error, refetch } = useSkillFileContent(skillName, path);
  return (
    <Section
      surface="card"
      title={path}
      titleClassName={FILE_TITLE}
      description={
        <>
          Only Markdown (<Code>.md</Code>) files can be edited here. Rename, delete, or export this file from the tree
          above.
        </>
      }
      action={<Badge variant="outline">Read-only</Badge>}
      contentClassName="gap-3"
      content={
        <>
          {isPending && <Skeleton className="h-[50vh] w-full" />}
          {error && <QueryError error={error} onRetry={() => void refetch()} what="this file" />}
          {data?.binary && (
            <EmptyState
              icon={File}
              title="Binary file"
              description={`${formatBytes(data.size)}. Export the skill as a .zip to work with it.`}
            />
          )}
          {data && !data.binary && (
            <Textarea
              value={data.content}
              readOnly
              spellCheck={false}
              className="h-[50vh] resize-none bg-muted/30 font-mono text-sm leading-relaxed"
            />
          )}
        </>
      }
    />
  );
}
