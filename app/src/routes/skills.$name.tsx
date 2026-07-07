import type { SkillDetail } from '@mcp-skills/shared';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeftIcon, EyeIcon, FileIcon, PencilIcon, SaveIcon, SplitIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MarkdownPreview } from '@/components/domain/skill/markdown-preview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useSkill, useUpdateSkill } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/skills/$name')({
  component: SkillEditorPage,
});

type ViewMode = 'edit' | 'split' | 'preview';

function SkillEditorPage() {
  const { name } = Route.useParams();
  const { data, isPending, error } = useSkill(name);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2 text-muted-foreground">
          <Link to="/">
            <ArrowLeftIcon /> All skills
          </Link>
        </Button>
      </div>
      {isPending && <Skeleton className="h-[70vh] w-full" />}
      {error && <p className="text-sm text-destructive">Failed to load skill: {error.message}</p>}
      {data && <SkillEditor key={data.name} skill={data} />}
    </div>
  );
}

function SkillEditor({ skill }: { skill: SkillDetail }) {
  const navigate = useNavigate();
  const update = useUpdateSkill(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [body, setBody] = useState(skill.body);
  const [view, setView] = useState<ViewMode>('split');

  const dirty = description !== skill.description || body !== skill.body;

  // Warn before leaving with unsaved edits (covers tab close / reload).
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = () => {
    update.mutate(
      { description, body },
      {
        onSuccess: () => toast.success('Skill saved'),
        onError: toastApiError,
      },
    );
  };

  // Cmd/Ctrl+S to save. description/body stay in deps: the handler closes over save(), which
  // reads them, so a stale closure would otherwise persist outdated content.
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
  }, [dirty, update.isPending, description, body]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold">{skill.name}</h1>
            <RenameButton
              skill={skill}
              onRenamed={(next) => navigate({ to: '/skills/$name', params: { name: next } })}
            />
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {skill.format === 'dir' ? `skills/${skill.name}/SKILL.md` : `skills/${skill.path}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle view={view} onChange={setView} />
          <Button onClick={save} disabled={!dirty || update.isPending}>
            <SaveIcon /> {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="skill-description">Description</Label>
        <Input
          id="skill-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="One line telling the agent when to use this skill."
        />
        <p className="text-xs text-muted-foreground">Surfaced as the MCP tool and resource description.</p>
      </div>

      <div className={cn('grid min-h-[60vh] gap-4', view === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1')}>
        {view !== 'preview' && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="skill-body" className="text-xs text-muted-foreground">
              Markdown
            </Label>
            <Textarea
              id="skill-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              spellCheck={false}
              className="min-h-[60vh] flex-1 resize-none font-mono text-sm leading-relaxed"
              placeholder="# My skill&#10;&#10;Write the skill instructions here…"
            />
          </div>
        )}
        {view !== 'edit' && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Preview</span>
            <div className="min-h-[60vh] flex-1 overflow-auto rounded-md border bg-card p-4">
              <MarkdownPreview content={body} />
            </div>
          </div>
        )}
      </div>

      {skill.files.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Supporting files</h2>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {skill.files.map((file) => (
              <li key={file.path} className="flex items-center gap-2">
                <FileIcon className="size-3.5" />
                <span className="font-mono">{file.path}</span>
                <span className="text-xs">({file.size} bytes)</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Edit or add supporting files directly in the <code className="font-mono">skills/{skill.name}/</code>{' '}
            directory on disk; changes are picked up automatically.
          </p>
        </div>
      )}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (view: ViewMode) => void }) {
  const options: { value: ViewMode; label: string; icon: typeof EyeIcon }[] = [
    { value: 'edit', label: 'Edit', icon: PencilIcon },
    { value: 'split', label: 'Split', icon: SplitIcon },
    { value: 'preview', label: 'Preview', icon: EyeIcon },
  ];
  return (
    <div className="flex rounded-md border p-0.5">
      {options.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          variant={view === value ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5"
          onClick={() => onChange(value)}
          aria-pressed={view === value}
        >
          <Icon className="size-3.5" /> <span className="hidden sm:inline">{label}</span>
        </Button>
      ))}
    </div>
  );
}

function RenameButton({ skill, onRenamed }: { skill: SkillDetail; onRenamed: (name: string) => void }) {
  const update = useUpdateSkill(skill.name);
  const rename = () => {
    const next = window.prompt('Rename skill (lowercase id):', skill.name)?.trim();
    if (!next || next === skill.name) {
      return;
    }
    update.mutate(
      { name: next },
      {
        onSuccess: (result) => {
          toast.success(`Renamed to ${result.name}`);
          onRenamed(result.name);
        },
        onError: toastApiError,
      },
    );
  };
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Rename skill" onClick={rename}>
      <PencilIcon />
    </Button>
  );
}
