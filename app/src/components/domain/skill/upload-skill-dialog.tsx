import { slugSchema } from '@mcp-skills/shared';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { FileArchive } from '@/components/app-icons';
import { FormField } from '@/components/form-field';
import { Alert } from '@/components/ui/alert';
import { Code } from '@/components/ui/code';
import { FilePickerButton } from '@/components/ui/file-picker';
import { FileText, Folder } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { useImportSkill } from '@/lib/queries';
import { type NormalizedUpload, normalizeUploadFile, normalizeUploadFolder } from '@/lib/skill-upload';
import { useToasts } from '@/lib/toast';

export const UPLOAD_SKILL_FORM_ID = 'upload-skill-form';

/** What the surrounding dialog needs to draw (and guard) the import button it owns. */
export interface UploadStatus {
  /** A valid upload with a valid id is staged. */
  ready: boolean;
  /** The import request is in flight. */
  pending: boolean;
  /** Something has been picked, so closing would lose it. */
  dirty: boolean;
}

/**
 * Upload a skill from an `.md` file, a picked folder, or a `.zip` archive.
 * The client normalizes all three (unzipping in-browser) and posts one payload.
 * Rendered as a tab inside {@link NewSkillDialog}, which owns the dialog and the footer's
 * submit button (`form={UPLOAD_SKILL_FORM_ID}`); this reports its state through `onStatusChange`.
 */
export function UploadSkillForm({
  onStatusChange,
  onImported,
}: {
  onStatusChange: (status: UploadStatus) => void;
  onImported: () => void;
}) {
  const toast = useToasts();
  const navigate = useNavigate();
  const importSkill = useImportSkill();
  const [upload, setUpload] = useState<NormalizedUpload | null>(null);
  const [name, setName] = useState('');

  const nameValid = slugSchema.safeParse(name).success;
  const ready = upload !== null && !upload.error && nameValid;
  const pending = importSkill.isPending;
  const dirty = upload !== null;

  useEffect(() => onStatusChange({ ready, pending, dirty }), [ready, pending, dirty, onStatusChange]);
  // Switching tabs unmounts this form and drops what was picked, so the dialog must stop guarding it.
  useEffect(() => () => onStatusChange({ ready: false, pending: false, dirty: false }), [onStatusChange]);

  const stage = (normalize: () => NormalizedUpload) => {
    try {
      const result = normalize();
      setUpload(result);
      setName(result.defaultName);
    } catch (error) {
      // A corrupt archive throws while it is unpacked.
      toast.apiError(error);
      setUpload(null);
    }
  };

  const submit = () => {
    if (!upload || upload.error || !nameValid || pending) {
      return;
    }
    importSkill.mutate(
      { name, format: upload.format, files: upload.files },
      {
        onSuccess: (skill) => {
          onImported();
          navigate({ to: '/skills/$name', params: { name: skill.name } });
        },
        onError: toast.apiError,
      },
    );
  };

  return (
    <form
      id={UPLOAD_SKILL_FORM_ID}
      className="flex flex-col gap-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Import a single <Code>.md</Code> file, a folder (its <Code>SKILL.md</Code> plus supporting files), or a{' '}
        <Code>.zip</Code> archive that is unpacked into a directory skill.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <FilePickerButton
          variant="outline"
          label="Choose .md or .zip"
          icon={<FileText />}
          accept=".md,.markdown,.zip,application/zip"
          read="bytes"
          onPickMany={([file]) => file && stage(() => normalizeUploadFile(file))}
        />
        <FilePickerButton
          variant="outline"
          label="Choose folder"
          icon={<Folder />}
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
          <FormField
            label="Skill id"
            required
            error={nameValid ? undefined : 'Must be a lowercase slug (letters, digits, dots, dashes, underscores).'}
            control={<Input value={name} onChange={(event) => setName(event.target.value)} />}
          />

          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-sm font-medium">
              {upload.format === 'dir' ? <FileArchive className="size-4" /> : <FileText className="size-4" />}
              {upload.format === 'dir' ? 'Directory skill' : 'File skill'} · {upload.paths.length} file
              {upload.paths.length === 1 ? '' : 's'}
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
    </form>
  );
}
