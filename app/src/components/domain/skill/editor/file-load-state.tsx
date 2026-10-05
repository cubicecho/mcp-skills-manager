import { EmptyState } from '@/components/page';
import { QueryError } from '@/components/query-state';
import { File } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes } from '@/lib/format';
import type { useSkillFileContent } from '@/lib/queries';

/**
 * What a file view shows instead of the file's text: a skeleton while it loads, the error with a retry,
 * or a notice that the file is binary. Renders nothing once text content is available.
 * @param file - The file-content query the view is reading.
 * @param describeBinary - Builds the binary notice from the file's formatted size, e.g. `1.2 KB`.
 */
export function FileLoadState({
  file,
  describeBinary,
}: {
  file: ReturnType<typeof useSkillFileContent>;
  describeBinary: (formattedSize: string) => string;
}) {
  const { data, isPending, error, refetch } = file;
  return (
    <>
      {isPending && <Skeleton className="h-[50vh] w-full" />}
      {error && <QueryError error={error} onRetry={() => void refetch()} what="this file" />}
      {data?.binary && (
        <EmptyState icon={File} title="Binary file" description={describeBinary(formatBytes(data.size))} />
      )}
    </>
  );
}
