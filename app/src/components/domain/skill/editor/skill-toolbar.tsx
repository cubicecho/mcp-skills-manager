import type { SkillDetail } from '@mcp-skills/shared';
import { useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { FilePlus, FolderPlus, FolderUp } from '@/components/app-icons';
import { LinkSourceButton } from '@/components/domain/skill/editor/link-source-button';
import { RenameButton } from '@/components/domain/skill/editor/rename-button';
import { useSyncNow } from '@/components/domain/skill/editor/use-sync-now';
import { DownloadButton } from '@/components/ui/download-button';
import { FilePickerButton } from '@/components/ui/file-picker';
import type { PickedFile } from '@/components/ui/file-picker-base';
import { RefreshCw } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/spinner';
import { exportSkill } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { useWriteSkillFile } from '@/lib/queries';
import { pickedToSkillFileContent } from '@/lib/skill-upload';
import { useToasts } from '@/lib/toast';

const TOOLBAR_BUTTON = { variant: 'ghost', size: 'icon-sm' } as const;

/**
 * The buttons over a skill's file list: add or upload files, export, link to a git repo and rename.
 * A skill linked to a git source has a Sync button in place of the ones that change its content.
 */
export function SkillToolbar({
  skill,
  onNewFile,
  onNewFolder,
  onRenamed,
}: {
  skill: SkillDetail;
  /** Called to ask for a new file's path, at the skill root. */
  onNewFile: () => void;
  /** Called to ask for a new folder's path, at the skill root. */
  onNewFolder: () => void;
  /** Called with the skill's new name once a rename has been saved. */
  onRenamed: (name: string) => void;
}) {
  const toast = useToasts();
  const writeFile = useWriteSkillFile(skill.name);
  const syncNow = useSyncNow(skill.name);
  const [busy, setBusy] = useState(false);
  const linked = skill.source !== undefined;

  const upload = async (files: PickedFile[]) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      // Sequential: each write reloads the skill, and the first promotes a file skill to a dir.
      for (const file of files) {
        await writeFile.mutateAsync(pickedToSkillFileContent(file));
      }
      toast.success(`Added ${formatCount(files.length, 'file')}`);
    } catch (error) {
      toast.apiError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      {linked ? (
        <ActionButton
          {...TOOLBAR_BUTTON}
          label="Sync from Git"
          hint={syncNow.pending ? 'Syncing…' : undefined}
          disabled={syncNow.pending}
          onClick={syncNow.sync}
          // Not `loading`, which disables the button outright and takes the hint's tooltip with it.
          iconSlot={syncNow.pending ? <Spinner /> : <RefreshCw />}
        />
      ) : (
        <>
          <ActionButton
            {...TOOLBAR_BUTTON}
            label="New file"
            disabled={busy}
            onClick={onNewFile}
            iconSlot={<FilePlus />}
          />
          <ActionButton
            {...TOOLBAR_BUTTON}
            label="New folder"
            disabled={busy}
            onClick={onNewFolder}
            iconSlot={<FolderPlus />}
          />
          <FilePickerButton {...TOOLBAR_BUTTON} label="Add files" multiple read="bytes" onPickMany={upload} />
          <FilePickerButton
            {...TOOLBAR_BUTTON}
            label="Add folder"
            iconSlot={<FolderUp />}
            directory
            read="bytes"
            onPickMany={upload}
          />
        </>
      )}
      <DownloadButton
        {...TOOLBAR_BUTTON}
        label="Export .zip"
        filename={`${skill.name}.zip`}
        source={() => exportSkill(skill.name)}
        onError={toast.apiError}
      />
      {!linked && <LinkSourceButton skill={skill} />}
      <RenameButton skill={skill} onRenamed={onRenamed} />
    </div>
  );
}
