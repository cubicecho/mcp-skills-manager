import type { SkillDetail } from '@mcp-skills/shared';
import { useEffect, useRef, useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { File, FilePlus, FileText, Folder, FolderPlus, FolderUp } from '@/components/app-icons';
import { ConfirmButton } from '@/components/confirm-button';
import { buildTree, isMarkdownPath, SKILL_MD_KEY, type TreeNode } from '@/components/domain/skill/editor/file-tree';
import { type PathPrompt, PathPromptDialog } from '@/components/domain/skill/path-prompt-dialog';
import { Section } from '@/components/section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { Download, Pencil, Trash2, Upload } from '@/components/ui/icons';
import { exportSkill } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useCreateSkillFolder, useDeleteSkillFile, useMoveSkillPath, useWriteSkillFile } from '@/lib/queries';
import { reported } from '@/lib/reported';
import { fileToSkillFileContent } from '@/lib/skill-upload';
import { useToasts } from '@/lib/toast';
import { cn, HOVER_REVEAL } from '@/lib/utils';

/**
 * The file tree and its management toolbar: the skill's own Markdown (first, un-renamable) plus every
 * supporting file and folder, with create / upload / rename / delete / export actions.
 */
export function FilesPanel({
  skill,
  selected,
  onSelect,
}: {
  skill: SkillDetail;
  selected: string;
  onSelect: (path: string) => void;
}) {
  const toast = useToasts();
  const writeFile = useWriteSkillFile(skill.name);
  const createFolder = useCreateSkillFolder(skill.name);
  const movePath = useMoveSkillPath(skill.name);
  const deleteEntry = useDeleteSkillFile(skill.name);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<PathPrompt | null>(null);

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const tree = buildTree(skill.files);
  const mainLabel = skill.format === 'dir' ? 'SKILL.md' : `${skill.name}.md`;

  const upload = async (files: FileList) => {
    setBusy(true);
    try {
      // Sequential: each write reloads the skill, and the first promotes a file skill to a dir.
      for (const file of [...files]) {
        await writeFile.mutateAsync(await fileToSkillFileContent(file));
      }
      toast.success(`Added ${files.length} file${files.length === 1 ? '' : 's'}`);
    } catch (error) {
      toast.apiError(error);
    } finally {
      setBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (folderInputRef.current) {
        folderInputRef.current.value = '';
      }
    }
  };

  const newFile = (base = '') =>
    setPrompt({
      title: 'New file',
      description: base ? (
        <>
          Created under <Code>{base}/</Code>.
        </>
      ) : (
        'A path relative to the skill root.'
      ),
      label: 'Path',
      placeholder: base ? 'intro.md' : 'docs/intro.md',
      submitLabel: 'Create file',
      onSubmit: async (rel) => {
        const path = base ? `${base}/${rel}` : rel;
        await reported(writeFile.mutateAsync({ path, content: '', encoding: 'utf8' }), toast.apiError);
        onSelect(path);
      },
    });

  const newFolder = (base = '') =>
    setPrompt({
      title: 'New folder',
      description: base ? (
        <>
          Created under <Code>{base}/</Code>.
        </>
      ) : (
        'A path relative to the skill root.'
      ),
      label: base ? 'Name' : 'Path',
      placeholder: base ? 'examples' : 'reference/examples',
      submitLabel: 'Create folder',
      onSubmit: (rel) => reported(createFolder.mutateAsync({ path: base ? `${base}/${rel}` : rel }), toast.apiError),
    });

  const rename = (node: TreeNode) =>
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

  const remove = (node: TreeNode) => {
    deleteEntry.mutate(node.path, {
      onSuccess: () => toast.success(`Deleted ${node.path}`),
      onError: toast.apiError,
    });
  };

  const runExport = async () => {
    try {
      const blob = await exportSkill(skill.name);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${skill.name}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.apiError(error);
    }
  };

  return (
    <Section
      title="Files"
      description={
        <>
          Files live under <Code>skills/{skill.name}/</Code>; you can also edit them on disk.
        </>
      }
      content={
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => newFile()}>
              <FilePlus /> New file
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => newFolder()}>
              <FolderPlus /> New folder
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload /> Add files
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => folderInputRef.current?.click()}
            >
              <FolderUp /> Add folder
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={runExport}>
              <Download /> Export .zip
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            onChange={(event) => {
              if (event.target.files?.length) {
                void upload(event.target.files);
              }
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            hidden
            multiple
            onChange={(event) => {
              if (event.target.files?.length) {
                void upload(event.target.files);
              }
            }}
          />

          <ul className="flex flex-col rounded-md border py-1">
            {/* The skill's own Markdown — always first, and never renamable/deletable. */}
            <li
              className={cn(
                'flex items-center gap-2 px-2 py-1 text-sm',
                selected === SKILL_MD_KEY ? 'bg-accent' : 'hover:bg-muted/50',
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => onSelect(SKILL_MD_KEY)}
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate font-mono">{mainLabel}</span>
                <Badge variant="secondary">main</Badge>
              </button>
            </li>
            {tree.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={0}
                selected={selected}
                onSelect={onSelect}
                onNewFile={newFile}
                onNewFolder={newFolder}
                onRename={rename}
                onDelete={remove}
              />
            ))}
          </ul>
          {prompt && <PathPromptDialog prompt={prompt} onClose={() => setPrompt(null)} />}
        </>
      }
    />
  );
}

function FileTreeNode({
  node,
  depth,
  selected,
  onSelect,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  selected: string;
  onSelect: (path: string) => void;
  onNewFile: (base: string) => void;
  onNewFolder: (base: string) => void;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
}) {
  const isDir = node.type === 'dir';
  const isSelected = !isDir && selected === node.path;
  return (
    <>
      <li
        className={cn(
          'group flex items-center gap-2 px-2 py-1 text-sm',
          isSelected ? 'bg-accent' : 'hover:bg-muted/50',
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: `${depth * 16}px` }}>
          {isDir ? (
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <File className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          {isDir ? (
            <span className="min-w-0 truncate font-mono">{node.name}</span>
          ) : (
            <button
              type="button"
              className="min-w-0 truncate text-left font-mono"
              onClick={() => onSelect(node.path)}
              title={isMarkdownPath(node.path) ? 'Edit file' : 'View file (read-only)'}
            >
              {node.name}
            </button>
          )}
          {!isDir && <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(node.size)}</span>}
        </span>
        <span className={cn('flex shrink-0 items-center gap-0.5 focus-within:opacity-100', HOVER_REVEAL)}>
          {isDir && (
            <>
              <ActionButton
                variant="ghost"
                size="icon-sm"
                label={`New file in ${node.path}`}
                onClick={() => onNewFile(node.path)}
              >
                <FilePlus />
              </ActionButton>
              <ActionButton
                variant="ghost"
                size="icon-sm"
                label={`New folder in ${node.path}`}
                onClick={() => onNewFolder(node.path)}
              >
                <FolderPlus />
              </ActionButton>
            </>
          )}
          <ActionButton variant="ghost" size="icon-sm" label={`Rename ${node.path}`} onClick={() => onRename(node)}>
            <Pencil />
          </ActionButton>
          <ConfirmButton
            variant="ghost"
            size="icon-sm"
            label={`Delete ${node.path}`}
            title={`Delete ${isDir ? 'folder' : 'file'} "${node.path}"?`}
            description={
              isDir
                ? 'Every file inside the folder is deleted with it, on disk as well as here.'
                : 'The file is deleted from the skill on disk, and anything linking to it breaks.'
            }
            onConfirm={() => onDelete(node)}
          >
            <Trash2 />
          </ConfirmButton>
        </span>
      </li>
      {node.children.map((child) => (
        <FileTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}
