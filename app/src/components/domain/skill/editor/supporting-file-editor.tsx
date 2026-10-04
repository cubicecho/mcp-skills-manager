import { useEffect, useState } from 'react';
import { EditorFrame } from '@/components/domain/skill/editor/editor-frame';
import { FileLoadState } from '@/components/domain/skill/editor/file-load-state';
import { MarkdownEditor } from '@/components/markdown-editor';
import { useSkillFileContent, useWriteSkillFile } from '@/lib/queries';
import { useToasts } from '@/lib/toast';
import { useSaveShortcut } from '@/lib/use-save-shortcut';

/** Edit a supporting `.md` file's contents. */
export function SupportingFileEditor({
  skillName,
  path,
  onDirtyChange,
  onClose,
}: {
  skillName: string;
  path: string;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
}) {
  const toast = useToasts();
  const file = useSkillFileContent(skillName, path);
  const { data } = file;
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

  useSaveShortcut(save, dirty && !write.isPending);

  return (
    <EditorFrame
      path={path}
      onSave={save}
      onClose={onClose}
      saving={write.isPending}
      dirty={dirty}
      content={
        <>
          <FileLoadState
            file={file}
            describeBinary={(size) => `This file is binary (${size}) and cannot be edited here.`}
          />
          {data && !data.binary && content !== null && (
            <MarkdownEditor
              aria-label={path}
              value={content}
              onValueChange={setContent}
              empty="Nothing to preview yet."
            />
          )}
        </>
      }
    />
  );
}
