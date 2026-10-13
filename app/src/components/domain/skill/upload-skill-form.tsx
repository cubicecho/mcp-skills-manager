import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { InputField, useAppForm } from '@/components/app-form';
import { FileArchive } from '@/components/app-icons';
import { Alert } from '@/components/ui/alert';
import { Code } from '@/components/ui/code';
import { FilePickerButton } from '@/components/ui/file-picker';
import { FormElement } from '@/components/ui/form-element';
import { FileText, Folder } from '@/components/ui/icons';
import { useFormStore } from '@/lib/form-store';
import { formatCount, joinStats } from '@/lib/format';
import { useImportSkill } from '@/lib/queries';
import { type NormalizedUpload, normalizeUploadFile, normalizeUploadFolder } from '@/lib/skill-upload';
import { useToasts } from '@/lib/toast';
import { IDLE_IMPORT, type ImportStatus, validateSkillId } from './import-status';

/** The form's id, which the dialog's submit button names. */
export const UPLOAD_SKILL_FORM_ID = 'upload-skill-form';

/**
 * The form that uploads a skill from an `.md` file, a picked folder, or a `.zip` archive.
 *
 * @remarks
 * The client normalizes all three (unzipping in-browser) and posts one payload.
 * Rendered as a tab inside {@link NewSkillDialog}, which owns the dialog and the footer's
 * submit button (`form={UPLOAD_SKILL_FORM_ID}`); this reports its state through `onStatusChange`.
 */
export function UploadSkillForm({
  onStatusChange,
  onImported,
}: {
  /** Called with the form's state whenever it changes, and with `IDLE_IMPORT` when the form unmounts. */
  onStatusChange: (status: ImportStatus) => void;
  /** Called once the skill has been imported, before the app goes to it. */
  onImported: () => void;
}) {
  const toast = useToasts();
  const navigate = useNavigate();
  const importSkill = useImportSkill();
  const [upload, setUpload] = useState<NormalizedUpload | null>(null);
  const form = useAppForm({
    defaultValues: { name: '' },
    onSubmit: ({ value }) => {
      if (!upload || upload.error || importSkill.isPending) {
        return;
      }
      importSkill.mutate(
        { name: value.name, format: upload.format, files: upload.files },
        {
          onSuccess: (skill) => {
            onImported();
            navigate({ to: '/skills/$name', params: { name: skill.name } });
          },
          onError: toast.apiError,
        },
      );
    },
  });
  const name = useFormStore(form.store, (state) => state.values.name);

  const nameValid = validateSkillId({ value: name }) === undefined;
  const ready = upload !== null && !upload.error && nameValid;
  const pending = importSkill.isPending;
  const dirty = upload !== null;

  useEffect(() => onStatusChange({ ready, pending, dirty }), [ready, pending, dirty, onStatusChange]);
  // Switching tabs unmounts this form and drops what was picked, so the dialog must stop guarding it.
  useEffect(() => () => onStatusChange(IDLE_IMPORT), [onStatusChange]);

  const stage = (normalize: () => NormalizedUpload) => {
    try {
      const result = normalize();
      setUpload(result);
      form.setFieldValue('name', result.defaultName);
    } catch (error) {
      // A corrupt archive throws while it is unpacked.
      toast.apiError(error);
      setUpload(null);
    }
  };

  return (
    <FormElement id={UPLOAD_SKILL_FORM_ID} className="gap-4 py-4" onSubmit={() => void form.handleSubmit()}>
      <p className="text-sm text-muted-foreground">
        Import a single <Code>.md</Code> file, a folder (its <Code>SKILL.md</Code> plus supporting files), or a{' '}
        <Code>.zip</Code> archive that is unpacked into a directory skill.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <FilePickerButton
          variant="outline"
          label="Choose .md or .zip"
          iconSlot={<FileText />}
          accept=".md,.markdown,.zip,application/zip"
          read="bytes"
          onPickMany={([file]) => file && stage(() => normalizeUploadFile(file))}
        />
        <FilePickerButton
          variant="outline"
          label="Choose folder"
          iconSlot={<Folder />}
          directory
          read="bytes"
          onPickMany={(files) => files.length > 0 && stage(() => normalizeUploadFolder(files))}
        />
      </div>

      {upload?.error && (
        <Alert variant="destructive" title="This upload can’t be imported" description={upload.error} />
      )}

      {upload && !upload.error && (
        <>
          <InputField
            form={form}
            name="name"
            label="Skill id"
            required
            validators={{ onMount: validateSkillId, onChange: validateSkillId }}
          />

          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-sm font-medium">
              {upload.format === 'dir' ? <FileArchive className="size-4" /> : <FileText className="size-4" />}
              {joinStats(
                upload.format === 'dir' ? 'Directory skill' : 'File skill',
                formatCount(upload.paths.length, 'file'),
              )}
            </span>
            <ul className="max-h-40 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-xs text-muted-foreground">
              {upload.paths.map((filePath) => (
                <li key={filePath} className="truncate">
                  {filePath}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </FormElement>
  );
}
