import { skillNameSchema } from '@mcp-skills/shared';
import { useNavigate } from '@tanstack/react-router';
import { FileArchiveIcon, FileTextIcon, FolderIcon, UploadIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useImportSkill } from '@/lib/queries';
import { type NormalizedUpload, normalizeUploadFile, normalizeUploadFolder } from '@/lib/skill-upload';
import { toastApiError } from '@/lib/toast';

/**
 * Upload a skill from an `.md` file, a picked folder, or a `.zip` archive.
 * The client normalizes all three (unzipping in-browser) and posts one payload.
 */
export function UploadSkillDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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

  const reset = () => {
    setUpload(null);
    setName('');
    setReading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
    }
  };

  const close = (next: boolean) => {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  };

  const handle = async (normalize: () => Promise<NormalizedUpload>) => {
    setReading(true);
    try {
      const result = await normalize();
      setUpload(result);
      setName(result.defaultName);
    } catch (error) {
      toastApiError(error);
      setUpload(null);
    } finally {
      setReading(false);
    }
  };

  const nameValid = skillNameSchema.safeParse(name).success;
  const canImport = upload !== null && !upload.error && nameValid && !importSkill.isPending;

  const submit = () => {
    if (!upload || upload.error) {
      return;
    }
    importSkill.mutate(
      { name, format: upload.format, files: upload.files },
      {
        onSuccess: (skill) => {
          close(false);
          navigate({ to: '/skills/$name', params: { name: skill.name } });
        },
        onError: toastApiError,
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a skill</DialogTitle>
          <DialogDescription>
            Import a single <code>.md</code> file, a folder (its <code>SKILL.md</code> plus supporting files), or a{' '}
            <code>.zip</code> archive that is unpacked into a directory skill.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" disabled={reading} onClick={() => fileInputRef.current?.click()}>
              <FileTextIcon /> Choose .md or .zip
            </Button>
            <Button type="button" variant="outline" disabled={reading} onClick={() => folderInputRef.current?.click()}>
              <FolderIcon /> Choose folder
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

          {reading && <p className="text-sm text-muted-foreground">Reading files…</p>}

          {upload?.error && <p className="text-sm text-destructive">{upload.error}</p>}

          {upload && !upload.error && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="upload-name">Skill id</Label>
                <Input id="upload-name" value={name} onChange={(event) => setName(event.target.value)} />
                {!nameValid && (
                  <p className="text-xs text-destructive">
                    Must be a lowercase slug (letters, digits, dots, dashes, underscores).
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {upload.format === 'dir' ? (
                    <FileArchiveIcon className="size-4" />
                  ) : (
                    <FileTextIcon className="size-4" />
                  )}
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
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!canImport}>
            <UploadIcon /> {importSkill.isPending ? 'Importing…' : 'Import skill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
