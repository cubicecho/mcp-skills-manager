import { skillNameSchema } from '@mcp-skills/shared';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { FileArchive, FileText, Folder } from '@/components/app-icons';
import { FormField } from '@/components/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<NormalizedUpload | null>(null);
  const [name, setName] = useState('');
  const [reading, setReading] = useState(false);

  // webkitdirectory is not in the React input typings; set it imperatively.
  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const nameValid = skillNameSchema.safeParse(name).success;
  const ready = upload !== null && !upload.error && nameValid;
  const pending = importSkill.isPending;
  const dirty = upload !== null;

  useEffect(() => onStatusChange({ ready, pending, dirty }), [ready, pending, dirty, onStatusChange]);
  // Switching tabs unmounts this form and drops what was picked, so the dialog must stop guarding it.
  useEffect(() => () => onStatusChange({ ready: false, pending: false, dirty: false }), [onStatusChange]);

  const handle = async (normalize: () => Promise<NormalizedUpload>) => {
    setReading(true);
    try {
      const result = await normalize();
      setUpload(result);
      setName(result.defaultName);
    } catch (error) {
      toast.apiError(error);
      setUpload(null);
    } finally {
      setReading(false);
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
        <Button type="button" variant="outline" disabled={reading} onClick={() => fileInputRef.current?.click()}>
          <FileText /> Choose .md or .zip
        </Button>
        <Button type="button" variant="outline" disabled={reading} onClick={() => folderInputRef.current?.click()}>
          <Folder /> Choose folder
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.zip,application/zip"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handle(() => normalizeUploadFile(file));
          }
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        multiple
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) {
            void handle(() => normalizeUploadFolder(files));
          }
        }}
      />

      {reading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label="Reading files" /> Reading files…
        </p>
      )}

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
