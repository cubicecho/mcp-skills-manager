import type { SkillDetail, SkillFile } from '@mcp-skills/shared';
import { useState } from 'react';
import { FilePlus, FolderPlus } from '@/components/app-icons';
import { SKILL_MD_KEY } from '@/components/domain/skill/editor/file-tree';
import { SkillToolbar } from '@/components/domain/skill/editor/skill-toolbar';
import { useFilePrompts } from '@/components/domain/skill/editor/use-file-prompts';
import { PathPromptDialog } from '@/components/domain/skill/path-prompt-dialog';
import { FileTree } from '@/components/file-tree';
import { StickyHeaderContentFooter } from '@/components/header-content-footer';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Ellipsis, FileText, Folder, Pencil, Trash2 } from '@/components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { formatBytes, formatCount } from '@/lib/format';
import { useDeleteSkillFile, useMoveSkillPath } from '@/lib/queries';
import { reported } from '@/lib/reported';
import { skillFileCount, skillFilesPath } from '@/lib/skill';
import { useToasts } from '@/lib/toast';
import type { TreeNode } from '@/lib/tree';

/** A row of the file tree: a supporting file or folder, or the skill's own Markdown pinned above them. */
type FileEntry = SkillFile & { main?: boolean };

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
  const movePath = useMoveSkillPath(skill.name);
  const deleteEntry = useDeleteSkillFile(skill.name);
  const prompts = useFilePrompts(skill.name, onSelect);
  // The file or folder whose Delete was chosen, until the question about it is answered.
  const [deleting, setDeleting] = useState<TreeNode<FileEntry> | null>(null);

  // A linked skill's content is the repo's: nothing here may add to it, rename in it or delete from it.
  const linked = skill.source !== undefined;
  const mainLabel = skill.format === 'dir' ? 'SKILL.md' : `${skill.name}.md`;
  // The skill's own Markdown is pinned under its file name; everywhere else it is `SKILL_MD_KEY`.
  const main: FileEntry = { path: mainLabel, type: 'file', size: 0, main: true };

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
            <SkillToolbar
              skill={skill}
              onNewFile={() => prompts.newFile()}
              onNewFolder={() => prompts.newFolder()}
              onRenamed={onRenamed}
            />
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
                  onNewFile={prompts.newFile}
                  onNewFolder={prompts.newFolder}
                  onRename={prompts.rename}
                  onDelete={setDeleting}
                />
              )
            }
          />
          {prompts.prompt && <PathPromptDialog prompt={prompts.prompt} onClose={prompts.close} />}
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
