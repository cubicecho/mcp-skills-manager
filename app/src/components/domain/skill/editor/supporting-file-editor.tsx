import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useAppForm } from '@/components/app-form';
import { EditorFrame, type EditorHandle } from '@/components/domain/skill/editor/editor-frame';
import { FileLoadState } from '@/components/domain/skill/editor/file-load-state';
import { MarkdownEditor } from '@/components/markdown-editor';
import { useFormStore } from '@/lib/form-store';
import { useSkillFileContent, useWriteSkillFile } from '@/lib/queries';
import { useToasts } from '@/lib/toast';
import { useSaveShortcut } from '@/lib/use-save-shortcut';

/** The editor for a supporting `.md` file's contents. */
export function SupportingFileEditor({
  skillName,
  path,
  ref,
  onClose,
}: {
  /** The skill the file belongs to. */
  skillName: string;
  /** The file's path relative to the skill root. */
  path: string;
  /** Lets the pane holding the editor ask whether it has unsaved edits. */
  ref?: Ref<EditorHandle>;
  /** Called when the reader leaves the editor for the preview. */
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

  const savedNow = useRef(saved);
  savedNow.current = saved;

  // The file arrives after the form exists, and again when a refetch finds it changed. Unsaved edits
  // outlive that: the refetch a save sets off lands while the reader may be typing again, and what
  // they typed is then measured against the text it brought.
  useEffect(() => {
    if (text === undefined) {
      return;
    }
    const untouched = savedNow.current === undefined || form.state.values.content === savedNow.current;
    setSaved(text);
    if (untouched) {
      form.reset({ content: text });
    }
  }, [text, form]);

  const content = useFormStore(form.store, (state) => state.values.content);
  const dirty = saved !== undefined && content !== saved;
  useImperativeHandle(ref, () => ({ hasUnsavedChanges: () => dirty }), [dirty]);

  const save = () => void form.handleSubmit();

  useSaveShortcut(save, dirty && write.isPending === false);

  return (
    <EditorFrame
      path={path}
      onSave={save}
      onClose={onClose}
      saving={write.isPending}
      dirty={dirty}
      contentSlot={
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
                  emptySlot={<p className="text-foreground/60">Nothing to preview yet.</p>}
                />
              )}
            </form.AppField>
          )}
        </>
      }
    />
  );
}
