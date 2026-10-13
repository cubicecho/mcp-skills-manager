import type { SkillDetail, SkillFile } from '@mcp-skills/shared';
import { type ReactNode, useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { FilePlus, FolderPlus, FolderUp } from '@/components/app-icons';
import { isMarkdownPath, SKILL_MD_KEY } from '@/components/domain/skill/editor/file-tree';
import { LinkSourceButton } from '@/components/domain/skill/editor/link-source-button';
import { RenameButton } from '@/components/domain/skill/editor/rename-button';
import { useSyncNow } from '@/components/domain/skill/editor/use-sync-now';
import { type PathPrompt, PathPromptDialog } from '@/components/domain/skill/path-prompt-dialog';
import { FileTree } from '@/components/file-tree';
import { StickyHeaderContentFooter } from '@/components/header-content-footer';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DownloadButton } from '@/components/ui/download-button';
import { FilePickerButton } from '@/components/ui/file-picker';
import type { PickedFile } from '@/components/ui/file-picker-base';
import { Ellipsis, FileText, Folder, Pencil, RefreshCw, Trash2 } from '@/components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Spinner } from '@/components/ui/spinner';
import { exportSkill } from '@/lib/api';
import { formatBytes, formatCount } from '@/lib/format';
import { useCreateSkillFolder, useDeleteSkillFile, useMoveSkillPath, useWriteSkillFile } from '@/lib/queries';
import { reported } from '@/lib/reported';
import { skillFileCount, skillFilesPath } from '@/lib/skill';
import { pickedToSkillFileContent } from '@/lib/skill-upload';
import { useToasts } from '@/lib/toast';
import type { TreeNode } from '@/lib/tree';

/** A row of the file tree: a supporting file or folder, or the skill's own Markdown pinned above them. */
type FileEntry = SkillFile & { main?: boolean };

/**
 * Describe where a new file or folder will be created.
 * @param base - The folder it is created under, relative to the skill root; empty for the root itself.
 * @returns The description shown in the path prompt.
 */
function pathHint(base: string): ReactNode {
  if (!base) {
    return 'A path relative to the skill root.';
  }
  return (
    <>
      Created under <Code>{base}/</Code>.
    </>
  );
}

/**
 * The skill's file list and its toolbar: the skill's own Markdown (first, un-renamable) plus every
 * supporting file and folder, with create / upload / rename / delete / export actions. A skill linked
 * to a git source is listed without the actions that change its content, and with a Sync button.
 * @param props.skill - The skill whose files are listed.
 * @param props.selected - The open file's path, or `SKILL_MD_KEY` for the skill's own Markdown.
 * @param props.onSelect - Called with the file to open; `edit` asks for it in the editor, as a new file is.
 * @param props.onRenamed - Called with the skill's new name once a rename has been saved.
 */
export function FilesPanel({
  skill,
  selected,
  onSelect,
  onRenamed,
}: {
  skill: SkillDetail;
  selected: string;
  onSelect: (path: string, options?: { edit?: boolean }) => void;
  onRenamed: (name: string) => void;
}) {
  const toast = useToasts();
  const writeFile = useWriteSkillFile(skill.name);
  const createFolder = useCreateSkillFolder(skill.name);
  const movePath = useMoveSkillPath(skill.name);
  const deleteEntry = useDeleteSkillFile(skill.name);
  const syncNow = useSyncNow(skill.name);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<PathPrompt | null>(null);
  // The file or folder whose Delete was chosen, until the question about it is answered.
  const [deleting, setDeleting] = useState<TreeNode<FileEntry> | null>(null);

  // A linked skill's content is the repo's: nothing here may add to it, rename in it or delete from it.
  const linked = skill.source !== undefined;
  const mainLabel = skill.format === 'dir' ? 'SKILL.md' : `${skill.name}.md`;
  // The skill's own Markdown is pinned under its file name; everywhere else it is `SKILL_MD_KEY`.
  const main: FileEntry = { path: mainLabel, type: 'file', size: 0, main: true };

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

  const newFile = (base = '') =>
    setPrompt({
      title: 'New file',
      description: pathHint(base),
      label: 'Path',
      placeholder: base ? 'intro.md' : 'docs/intro.md',
      submitLabel: 'Create file',
      onSubmit: async (rel) => {
        const path = base ? `${base}/${rel}` : rel;
        await reported(writeFile.mutateAsync({ path, content: '', encoding: 'utf8' }), toast.apiError);
        onSelect(path, { edit: isMarkdownPath(path) });
      },
    });

  const newFolder = (base = '') =>
    setPrompt({
      title: 'New folder',
      description: pathHint(base),
      label: base ? 'Name' : 'Path',
      placeholder: base ? 'examples' : 'reference/examples',
      submitLabel: 'Create folder',
      onSubmit: (rel) => reported(createFolder.mutateAsync({ path: base ? `${base}/${rel}` : rel }), toast.apiError),
    });

  const rename = (node: TreeNode<FileEntry>) =>
    setPrompt({
      title: `Rename ${node.type === 'dir' ? 'folder' : 'file'}`,
      description: 'A path relative to the skill root; changing the folders moves it.',
      label: 'Path',
      initial: node.path,
      submitLabel: 'Rename',
      onSubmit: async (next) => {
        await reported(movePath.mutateAsync({ from: node.path, to: next }), toast.apiError);
        toast.success(`Renamed to ${next}`);
      },
    });

  /**
   * Move a dragged file or folder into a folder, under the name it has.
   * @param from - The dragged path.
   * @param into - The folder it was dropped on; empty for the skill root.
   */
  const moveInto = async (from: string, into: string) => {
    const name = from.slice(from.lastIndexOf('/') + 1);
    const to = into ? `${into}/${name}` : name;
    await reported(movePath.mutateAsync({ from, to }), toast.apiError);
    toast.success(`Moved to ${to}`);
  };

  const remove = (node: TreeNode<FileEntry>) => {
    deleteEntry.mutate(node.path, {
      onSuccess: () => toast.success(`Deleted ${node.path}`),
      onError: toast.apiError,
    });
  };

  const toolbar = { variant: 'ghost', size: 'icon-sm' } as const;

  return (
    <StickyHeaderContentFooter
      headerSlot={
        <PageHeader
          level={2}
          // A narrow pane: the skill's name keeps 10rem, not the page header's 16, before its buttons
          // drop to a line of their own.
          className="[&_[data-slot=page-header-titles]]:basis-40"
          title={skill.name}
          iconSlot={skill.format === 'dir' ? <Folder /> : <FileText />}
          description={
            <>
              {formatCount(skillFileCount(skill), 'file')} under <Code>{skillFilesPath(skill)}</Code>
            </>
          }
          actionSlot={
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              {linked ? (
                <ActionButton
                  {...toolbar}
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
                    {...toolbar}
                    label="New file"
                    disabled={busy}
                    onClick={() => newFile()}
                    iconSlot={<FilePlus />}
                  />
                  <ActionButton
                    {...toolbar}
                    label="New folder"
                    disabled={busy}
                    onClick={() => newFolder()}
                    iconSlot={<FolderPlus />}
                  />
                  <FilePickerButton {...toolbar} label="Add files" multiple read="bytes" onPickMany={upload} />
                  <FilePickerButton
                    {...toolbar}
                    label="Add folder"
                    iconSlot={<FolderUp />}
                    directory
                    read="bytes"
                    onPickMany={upload}
                  />
                </>
              )}
              <DownloadButton
                {...toolbar}
                label="Export .zip"
                filename={`${skill.name}.zip`}
                source={() => exportSkill(skill.name)}
                onError={toast.apiError}
              />
              {!linked && <LinkSourceButton skill={skill} />}
              <RenameButton skill={skill} onRenamed={onRenamed} />
            </div>
          }
        />
      }
      contentClassName="px-2 pb-4"
      contentSlot={
        <>
          <FileTree<FileEntry>
            label="Skill files"
            // The skill's own Markdown — always first, and never renamable/deletable.
            pinned={[main]}
            entries={skill.files}
            selected={selected === SKILL_MD_KEY ? mainLabel : selected}
            onSelect={(path) => onSelect(path === mainLabel ? SKILL_MD_KEY : path)}
            onMove={linked ? undefined : moveInto}
            canMove={(node) => node.entry?.main !== true}
            meta={(node) => {
              if (node.entry?.main) {
                return <Badge variant="secondary">main</Badge>;
              }
              return node.type === 'file' && node.entry ? formatBytes(node.entry.size) : null;
            }}
            actionSlot={(node) =>
              linked || node.entry?.main ? null : (
                <FileActions
                  node={node}
                  onNewFile={newFile}
                  onNewFolder={newFolder}
                  onRename={rename}
                  onDelete={setDeleting}
                />
              )
            }
          />
          {prompt && <PathPromptDialog prompt={prompt} onClose={() => setPrompt(null)} />}
          {deleting && (
            <ConfirmDialog
              open
              onOpenChange={(open) => {
                if (!open) {
                  setDeleting(null);
                }
              }}
              title={`Delete ${deleting.type === 'dir' ? 'folder' : 'file'} "${deleting.path}"?`}
              description={
                deleting.type === 'dir'
                  ? 'Every file inside the folder is deleted with it, on disk as well as here.'
                  : 'The file is deleted from the skill on disk, and anything linking to it breaks.'
              }
              confirmLabel="Delete"
              onConfirm={() => {
                setDeleting(null);
                remove(deleting);
              }}
            />
          )}
        </>
      }
    />
  );
}

/**
 * A file's or folder's actions, behind one button at the end of its row: new file and new folder
 * inside a folder, then rename and delete.
 * @param props.node - The row's file or folder.
 */
function FileActions({
  node,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: {
  node: TreeNode<FileEntry>;
  onNewFile: (base: string) => void;
  onNewFolder: (base: string) => void;
  onRename: (node: TreeNode<FileEntry>) => void;
  onDelete: (node: TreeNode<FileEntry>) => void;
}) {
  // Every row opens a dialog, which takes the focus the menu would otherwise hand back to its button.
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${node.path}`} iconSlot={<Ellipsis />} />
      </MenuTrigger>
      <MenuContent align="end">
        {node.type === 'dir' && (
          <>
            <MenuItem label="New file" focusesElsewhere onSelect={() => onNewFile(node.path)} iconSlot={<FilePlus />} />
            <MenuItem
              label="New folder"
              focusesElsewhere
              onSelect={() => onNewFolder(node.path)}
              iconSlot={<FolderPlus />}
            />
            <MenuSeparator />
          </>
        )}
        <MenuItem label="Rename" focusesElsewhere onSelect={() => onRename(node)} iconSlot={<Pencil />} />
        <MenuItem label="Delete" destructive focusesElsewhere onSelect={() => onDelete(node)} iconSlot={<Trash2 />} />
      </MenuContent>
    </Menu>
  );
}
