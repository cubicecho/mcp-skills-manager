import { normalizeTags, type SkillDetail, type SkillFile, slugSchema } from '@mcp-skills/shared';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { File, FilePlus, FileText, Folder, FolderPlus, FolderUp, Lock, Save, Split } from '@/components/app-icons';
import { ConfirmButton } from '@/components/confirm-button';
import { MarkdownPreview } from '@/components/domain/skill/markdown-preview';
import { type PathPrompt, PathPromptDialog } from '@/components/domain/skill/path-prompt-dialog';
import { FormField } from '@/components/form-field';
import { MultiSelect } from '@/components/multi-select';
import { EmptyState } from '@/components/page';
import { PageLayout } from '@/components/page-layout';
import { QueryError } from '@/components/query-state';
import { Section } from '@/components/section';
import { SettingRow } from '@/components/setting-row';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ArrowLeft, Download, Eye, Pencil, Trash2, Upload } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { exportSkill } from '@/lib/api';
import {
  useCreateSkillFolder,
  useDeleteSkillFile,
  useMoveSkillPath,
  useSkill,
  useSkillFileContent,
  useSkills,
  useUpdateSkill,
  useWriteSkillFile,
} from '@/lib/queries';
import { fileToSkillFileContent } from '@/lib/skill-upload';
import { useToasts } from '@/lib/toast';
import { cn, HOVER_REVEAL } from '@/lib/utils';

export const Route = createFileRoute('/skills/$name')({
  component: SkillEditorPage,
});

type ViewMode = 'edit' | 'split' | 'preview';

/** Sentinel selection value for the skill's own Markdown (its `<name>.md` / `SKILL.md`). */
const SKILL_MD_KEY = '\0skill-md';

const isMarkdownPath = (path: string): boolean => /\.md$/i.test(path);

/** Rethrow after toasting, so a prompt dialog stays open on a failed request. */
async function reported<T>(request: Promise<T>, onError: (error: unknown) => void): Promise<T> {
  try {
    return await request;
  } catch (error) {
    onError(error);
    throw error;
  }
}

function SkillEditorPage() {
  const { name } = Route.useParams();
  const navigate = useNavigate();
  const skill = useSkill(name);
  const { data } = skill;

  return (
    <PageLayout
      breadcrumbs={
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link to="/">
            <ArrowLeft /> All skills
          </Link>
        </Button>
      }
      title={data?.name ?? name}
      description={
        data && (
          <span className="font-mono text-xs">
            {data.format === 'dir' ? `skills/${data.name}/` : `skills/${data.path}`}
          </span>
        )
      }
      loading={skill.isPending}
      action={
        data && (
          <>
            {data.readOnly && (
              <Badge variant="outline" className="gap-1 font-normal" title="Agents cannot modify this skill over MCP">
                <Lock className="size-3" /> Read-only
              </Badge>
            )}
            <RenameButton
              skill={data}
              onRenamed={(next) => navigate({ to: '/skills/$name', params: { name: next } })}
            />
          </>
        )
      }
      content={
        <div className="pb-6">
          {skill.isError ? (
            <QueryError error={skill.error} onRetry={() => void skill.refetch()} what="this skill" />
          ) : data ? (
            <SkillWorkspace key={data.name} skill={data} />
          ) : (
            <Skeleton className="h-[70vh] w-full" />
          )}
        </div>
      }
    />
  );
}

/**
 * Unified skill workspace: a file tree at the top (the skill's own Markdown plus every supporting
 * file and folder) and, below it, an editor for whatever is currently selected. Selecting the skill's
 * Markdown edits its description + body; selecting a `.md` file edits its contents; other files are read-only.
 */
function SkillWorkspace({ skill }: { skill: SkillDetail }) {
  const [selected, setSelected] = useState<string>(SKILL_MD_KEY);
  // A selection held back until the reader decides what happens to their unsaved edits.
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('split');
  const [dirty, setDirty] = useState(false);

  // If the open file is renamed or deleted out from under us, fall back to the skill's Markdown.
  useEffect(() => {
    if (selected !== SKILL_MD_KEY && !skill.files.some((f) => f.type === 'file' && f.path === selected)) {
      setSelected(SKILL_MD_KEY);
      setDirty(false);
    }
  }, [skill.files, selected]);

  // Warn before leaving with unsaved edits (covers tab close / reload).
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const select = (next: string) => {
    if (next === selected) {
      return;
    }
    if (dirty) {
      setPendingSelection(next);
      return;
    }
    setSelected(next);
  };

  const discardAndSelect = () => {
    if (pendingSelection !== null) {
      setDirty(false);
      setSelected(pendingSelection);
    }
    setPendingSelection(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <ConfirmDialog
        open={pendingSelection !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingSelection(null);
          }
        }}
        title="Discard unsaved changes?"
        description="The edits to the open file have not been saved, and opening another file loses them."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={discardAndSelect}
      />

      <FilesPanel skill={skill} selected={selected} onSelect={select} />

      {selected === SKILL_MD_KEY ? (
        <SkillBodyEditor skill={skill} view={view} setView={setView} onDirtyChange={setDirty} />
      ) : isMarkdownPath(selected) ? (
        <SupportingFileEditor
          key={selected}
          skillName={skill.name}
          path={selected}
          view={view}
          setView={setView}
          onDirtyChange={setDirty}
        />
      ) : (
        <ReadOnlyFileView key={selected} skillName={skill.name} path={selected} />
      )}
    </div>
  );
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  children: TreeNode[];
}

/** Build a nested tree from the flat, path-sorted entry list, synthesizing any missing parent folders. */
function buildTree(entries: SkillFile[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();
  const ensure = (nodePath: string, type: 'file' | 'dir', size: number): TreeNode => {
    const found = byPath.get(nodePath);
    if (found) {
      return found;
    }
    const slash = nodePath.lastIndexOf('/');
    const node: TreeNode = { name: nodePath.slice(slash + 1), path: nodePath, type, size, children: [] };
    byPath.set(nodePath, node);
    if (slash === -1) {
      roots.push(node);
    } else {
      ensure(nodePath.slice(0, slash), 'dir', 0).children.push(node);
    }
    return node;
  };
  for (const entry of entries) {
    ensure(entry.path, entry.type, entry.size);
  }
  const sortRec = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
    for (const node of nodes) {
      sortRec(node.children);
    }
  };
  sortRec(roots);
  return roots;
}

/**
 * The file tree and its management toolbar: the skill's own Markdown (first, un-renamable) plus every
 * supporting file and folder, with create / upload / rename / delete / export actions.
 */
function FilesPanel({
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

/** The Markdown editor grid used for both the skill body and supporting `.md` files. */
function MarkdownEditor({
  value,
  onChange,
  view,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  view: ViewMode;
  placeholder?: string;
}) {
  return (
    <div className={cn('grid min-h-[50vh] gap-4', view === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1')}>
      {view !== 'preview' && (
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="min-h-[50vh] flex-1 resize-none font-mono text-sm leading-relaxed"
          placeholder={placeholder}
        />
      )}
      {view !== 'edit' && (
        <div className="min-h-[50vh] flex-1 overflow-auto rounded-md border bg-card p-4">
          <MarkdownPreview content={value} />
        </div>
      )}
    </div>
  );
}

/** The card an editor sits on: the file path as its heading, the view toggle + Save at the far end. */
function EditorFrame({
  path,
  view,
  setView,
  onSave,
  saving,
  dirty,
  content,
}: {
  path: string;
  view: ViewMode;
  setView: (view: ViewMode) => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  content: ReactNode;
}) {
  return (
    <Section
      surface="card"
      title={path}
      titleClassName={FILE_TITLE}
      action={
        <div className="flex items-center gap-2">
          <ViewToggle view={view} onChange={setView} />
          <Button onClick={onSave} disabled={!dirty || saving}>
            <Save /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
      contentClassName="gap-3"
      content={content}
    />
  );
}

/** A file path as a `Section` title: the path as written, not the uppercase overline. */
const FILE_TITLE = 'font-mono text-sm normal-case tracking-normal text-foreground';

/** Edit the skill's own Markdown: its frontmatter description plus its body. */
function SkillBodyEditor({
  skill,
  view,
  setView,
  onDirtyChange,
}: {
  skill: SkillDetail;
  view: ViewMode;
  setView: (view: ViewMode) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const toast = useToasts();
  const update = useUpdateSkill(skill.name);
  const visibility = useUpdateSkill(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [body, setBody] = useState(skill.body);
  const [tags, setTags] = useState<string[]>(skill.tags);
  const { data: allSkills } = useSkills();

  // Every tag already in use, so an existing one is picked rather than retyped with a new spelling.
  const tagOptions = useMemo(
    () =>
      normalizeTags([...(allSkills ?? []).flatMap((s) => s.tags), ...skill.tags])
        .sort((a, b) => a.localeCompare(b))
        .map((tag) => ({ value: tag, label: tag })),
    [allSkills, skill.tags],
  );
  const tagsDirty = tags.join('\0') !== skill.tags.join('\0');

  const toggleGlobal = (next: boolean) => {
    visibility.mutate(
      { global: next },
      {
        onSuccess: () =>
          toast.success(next ? 'Now served on the root /mcp endpoint' : 'Now workspace-scoped — hidden from root /mcp'),
        onError: toast.apiError,
      },
    );
  };

  const toggleReadOnly = (next: boolean) => {
    visibility.mutate(
      { readOnly: next },
      {
        onSuccess: () =>
          toast.success(next ? 'Now read-only — agents can no longer modify it' : 'Agents can modify this skill again'),
        onError: toast.apiError,
      },
    );
  };

  const dirty = description !== skill.description || body !== skill.body || tagsDirty;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = () => {
    update.mutate(
      { description, body, tags },
      { onSuccess: () => toast.success('Skill saved'), onError: toast.apiError },
    );
  };

  // Cmd/Ctrl+S. description/body/tags stay in deps so the handler always saves the latest content.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — see comment above.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        if (dirty && !update.isPending) {
          save();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirty, update.isPending, description, body, tags]);

  const path = skill.format === 'dir' ? `skills/${skill.name}/SKILL.md` : `skills/${skill.path}`;

  return (
    <EditorFrame
      path={path}
      view={view}
      setView={setView}
      onSave={save}
      saving={update.isPending}
      dirty={dirty}
      content={
        <>
          <FormField
            label="Description"
            description="Surfaced as the MCP tool and resource description."
            control={
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="One line telling the agent when to use this skill."
              />
            }
          />
          <FormField
            label="Tags"
            description={
              <>
                Categories for organising and filtering skills. Written to the frontmatter <Code>tags</Code> key.
              </>
            }
            control={(wired) => (
              <MultiSelect
                {...wired}
                options={tagOptions}
                value={tags}
                onValueChange={setTags}
                onCreateOption={(tag) => setTags(normalizeTags([...tags, tag]))}
                createLabel="Add tag"
                placeholder="Add tags…"
                searchPlaceholder="Find or add a tag…"
                searchLabel="Find or add a tag"
                popoverLabel="Tags"
                emptyMessage="No tags yet. Type one to add it."
              />
            )}
          />
          <SettingRow
            title={
              <>
                Serve on root <Code>/mcp</Code>
              </>
            }
            description={
              <>
                On: every client of the root endpoint gets this skill. Off: workspace-scoped — hidden from root{' '}
                <Code>/mcp</Code>, served only on workspaces that list it (frontmatter <Code>global: false</Code>).
              </>
            }
            action={({ titleId, descriptionId }) => (
              <Switch
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                checked={skill.global}
                disabled={visibility.isPending}
                onCheckedChange={toggleGlobal}
              />
            )}
          />
          <SettingRow
            title="Read-only for agents"
            description={
              <>
                On: agents can still load this skill, but the MCP authoring tools refuse to edit, rename or delete it or
                {skill.format === 'dir' ? ' anything in its folder' : ' attach files to it'} (frontmatter{' '}
                <Code>readonly: true</Code>). You can still edit it here.
              </>
            }
            action={({ titleId, descriptionId }) => (
              <Switch
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                checked={skill.readOnly}
                disabled={visibility.isPending}
                onCheckedChange={toggleReadOnly}
              />
            )}
          />
          <MarkdownEditor value={body} onChange={setBody} view={view} placeholder="# My skill…" />
        </>
      }
    />
  );
}

/** Edit a supporting `.md` file's contents. */
function SupportingFileEditor({
  skillName,
  path,
  view,
  setView,
  onDirtyChange,
}: {
  skillName: string;
  path: string;
  view: ViewMode;
  setView: (view: ViewMode) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const toast = useToasts();
  const { data, isPending, error, refetch } = useSkillFileContent(skillName, path);
  const write = useWriteSkillFile(skillName);
  const [content, setContent] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);

  useEffect(() => {
    if (data && !data.binary) {
      setContent(data.content);
      setBaseline(data.content);
    }
  }, [data]);

  const dirty = content !== null && baseline !== null && content !== baseline;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = () => {
    if (content === null) {
      return;
    }
    write.mutate(
      { path, content, encoding: 'utf8' },
      {
        onSuccess: () => {
          toast.success(`Saved ${path}`);
          setBaseline(content);
        },
        onError: toast.apiError,
      },
    );
  };

  // Cmd/Ctrl+S; content stays in deps so the handler always saves the latest value.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — see comment above.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        if (dirty && !write.isPending) {
          save();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirty, write.isPending, content]);

  return (
    <EditorFrame
      path={path}
      view={view}
      setView={setView}
      onSave={save}
      saving={write.isPending}
      dirty={dirty}
      content={
        <>
          {isPending && <Skeleton className="h-[50vh] w-full" />}
          {error && <QueryError error={error} onRetry={() => void refetch()} what="this file" />}
          {data?.binary && (
            <EmptyState
              icon={File}
              title="Binary file"
              description={`This file is binary (${formatBytes(data.size)}) and cannot be edited here.`}
            />
          )}
          {data && !data.binary && content !== null && (
            <MarkdownEditor value={content} onChange={setContent} view={view} />
          )}
        </>
      }
    />
  );
}

/** Show a non-Markdown file read-only — its contents cannot be edited here. */
function ReadOnlyFileView({ skillName, path }: { skillName: string; path: string }) {
  const { data, isPending, error, refetch } = useSkillFileContent(skillName, path);
  return (
    <Section
      surface="card"
      title={path}
      titleClassName={FILE_TITLE}
      description={
        <>
          Only Markdown (<Code>.md</Code>) files can be edited here. Rename, delete, or export this file from the tree
          above.
        </>
      }
      action={<Badge variant="outline">Read-only</Badge>}
      contentClassName="gap-3"
      content={
        <>
          {isPending && <Skeleton className="h-[50vh] w-full" />}
          {error && <QueryError error={error} onRetry={() => void refetch()} what="this file" />}
          {data?.binary && (
            <EmptyState
              icon={File}
              title="Binary file"
              description={`${formatBytes(data.size)}. Export the skill as a .zip to work with it.`}
            />
          )}
          {data && !data.binary && (
            <Textarea
              value={data.content}
              readOnly
              spellCheck={false}
              className="h-[50vh] resize-none bg-muted/30 font-mono text-sm leading-relaxed"
            />
          )}
        </>
      }
    />
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const VIEW_OPTIONS = [
  { value: 'edit', label: 'Edit', icon: Pencil },
  { value: 'split', label: 'Split', icon: Split },
  { value: 'preview', label: 'Preview', icon: Eye },
] as const;

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (view: ViewMode) => void }) {
  return (
    <SegmentedGroup aria-label="Editor view" value={view} onValueChange={(next) => onChange(next as ViewMode)}>
      {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
        // The label is on screen from `sm` up; below it the icon stands alone and `aria-label` names it.
        <SegmentedButton
          key={value}
          value={value}
          aria-label={label}
          title={label}
          className="flex-row items-center gap-1.5"
        >
          <Icon className="size-3.5" />
          <span className="hidden font-medium text-sm sm:inline">{label}</span>
        </SegmentedButton>
      ))}
    </SegmentedGroup>
  );
}

function RenameButton({ skill, onRenamed }: { skill: SkillDetail; onRenamed: (name: string) => void }) {
  const toast = useToasts();
  const update = useUpdateSkill(skill.name);
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton variant="outline" size="icon" label="Rename skill" onClick={() => setOpen(true)}>
        <Pencil />
      </ActionButton>
      {open && (
        <PathPromptDialog
          onClose={() => setOpen(false)}
          prompt={{
            title: 'Rename skill',
            description: 'The id is the file or folder name on disk, and clients load the skill by it.',
            label: 'Skill id',
            initial: skill.name,
            submitLabel: 'Rename',
            validate: (value) =>
              slugSchema.safeParse(value).success
                ? undefined
                : 'Must be a lowercase slug (letters, digits, dots, dashes, underscores).',
            onSubmit: async (next) => {
              const result = await reported(update.mutateAsync({ name: next }), toast.apiError);
              toast.success(`Renamed to ${result.name}`);
              onRenamed(result.name);
            },
          }}
        />
      )}
    </>
  );
}
