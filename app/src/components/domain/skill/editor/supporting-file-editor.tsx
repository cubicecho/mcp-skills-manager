import { useStore } from '@tanstack/react-form';
import { useEffect, useState } from 'react';
import { useAppForm } from '@/components/app-form';
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
  const text = data && !data.binary ? data.content : undefined;
  // The file's text as last loaded or written: what an edit is measured against. Unset until the file arrives.
  const [saved, setSaved] = useState<string>();

  const form = useAppForm({
    defaultValues: { content: saved ?? '' },
    onSubmit: ({ value }) => {
      write.mutate(
        { path, content: value.content, encoding: 'utf8' },
        {
          onSuccess: () => {
            toast.success(`Saved ${path}`);
            setSaved(value.content);
          },
          onError: toast.apiError,
        },
      );
    },
  });

  // The file arrives after the form exists, and again when a refetch finds it changed.
  useEffect(() => {
    if (text !== undefined) {
      setSaved(text);
      form.reset({ content: text });
    }
  }, [text, form]);

  const content = useStore(form.store, (state) => state.values.content);
  const dirty = saved !== undefined && content !== saved;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = () => void form.handleSubmit();

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
          {saved !== undefined && (
            <form.AppField name="content">
              {(field) => (
                <MarkdownEditor
                  aria-label={path}
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  onBlur={field.handleBlur}
                  empty="Nothing to preview yet."
                />
              )}
            </form.AppField>
          )}
        </>
      }
    />
  );
}
