import { useEffect, useState } from 'react';
import { File } from '@/components/app-icons';
import { EditorFrame } from '@/components/domain/skill/editor/editor-frame';
import { MarkdownEditor } from '@/components/domain/skill/editor/markdown-editor';
import type { ViewMode } from '@/components/domain/skill/editor/view-toggle';
import { EmptyState } from '@/components/page';
import { QueryError } from '@/components/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes } from '@/lib/format';
import { useSkillFileContent, useWriteSkillFile } from '@/lib/queries';
import { useToasts } from '@/lib/toast';

/** Edit a supporting `.md` file's contents. */
export function SupportingFileEditor({
  skillName,
  path,
  view,
  setView,
  onDirtyChange,
}: {
  skillName: string;
  path: string;
  view: ViewMode;
  setView: (view: ViewMode) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const toast = useToasts();
  const { data, isPending, error, refetch } = useSkillFileContent(skillName, path);
  const write = useWriteSkillFile(skillName);
  const [content, setContent] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);

  useEffect(() => {
    if (data && !data.binary) {
      setContent(data.content);
      setBaseline(data.content);
    }
  }, [data]);

  const dirty = content !== null && baseline !== null && content !== baseline;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = () => {
    if (content === null) {
      return;
    }
    write.mutate(
      { path, content, encoding: 'utf8' },
      {
        onSuccess: () => {
          toast.success(`Saved ${path}`);
          setBaseline(content);
        },
        onError: toast.apiError,
      },
    );
  };

  // Cmd/Ctrl+S; content stays in deps so the handler always saves the latest value.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — see comment above.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        if (dirty && !write.isPending) {
          save();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirty, write.isPending, content]);

  return (
    <EditorFrame
      path={path}
      view={view}
      setView={setView}
      onSave={save}
      saving={write.isPending}
      dirty={dirty}
      content={
        <>
          {isPending && <Skeleton className="h-[50vh] w-full" />}
          {error && <QueryError error={error} onRetry={() => void refetch()} what="this file" />}
          {data?.binary && (
            <EmptyState
              icon={File}
              title="Binary file"
              description={`This file is binary (${formatBytes(data.size)}) and cannot be edited here.`}
            />
          )}
          {data && !data.binary && content !== null && (
            <MarkdownEditor value={content} onChange={setContent} view={view} />
          )}
        </>
      }
    />
  );
}
