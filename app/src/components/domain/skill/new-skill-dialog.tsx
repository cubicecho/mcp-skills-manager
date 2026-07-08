import type { SkillFormat } from '@mcp-skills/shared';
import { slugifySkillName } from '@mcp-skills/shared';
import { useNavigate } from '@tanstack/react-router';
import { FileTextIcon, FolderIcon } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useCreateSkill } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { UploadSkillForm } from './upload-skill-dialog';

/** New-skill dialog with two tabs: author one from scratch, or upload an existing file/folder/`.zip`. */
export function NewSkillDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>
            A skill is a Markdown document agents can load over MCP. Create one from scratch or upload an existing one.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="create">
          <TabsList className="w-full">
            <TabsTrigger value="create">Create skill</TabsTrigger>
            <TabsTrigger value="upload">Upload</TabsTrigger>
          </TabsList>
          <TabsContent value="create">
            <CreateSkillForm onOpenChange={onOpenChange} />
          </TabsContent>
          <TabsContent value="upload">
            <UploadSkillForm onOpenChange={onOpenChange} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** Create a skill from a title (which becomes the slug) + one-line description. Opens the editor on success. */
function CreateSkillForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const create = useCreateSkill();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<SkillFormat>('file');

  const name = slugifySkillName(title);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name) {
      return;
    }
    create.mutate(
      { title, description, format, body: `# ${title || name}\n\n` },
      {
        onSuccess: (skill) => {
          onOpenChange(false);
          setTitle('');
          setDescription('');
          setFormat('file');
          navigate({ to: '/skills/$name', params: { name: skill.name } });
        },
        onError: toastApiError,
      },
    );
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col gap-4 py-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="skill-title">Title</Label>
          <Input
            id="skill-title"
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Deploy to production"
          />
          {name && (
            <p className="text-xs text-muted-foreground">
              Skill id: <code className="font-mono">{name}</code>
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="skill-description">Description</Label>
          <Textarea
            id="skill-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="One line telling the agent when to use this skill."
            rows={2}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Layout</Label>
          <div className="grid grid-cols-2 gap-2">
            <FormatOption
              active={format === 'file'}
              onClick={() => setFormat('file')}
              icon={<FileTextIcon className="size-4" />}
              title="Single file"
              hint={`skills/${name || 'name'}.md`}
            />
            <FormatOption
              active={format === 'dir'}
              onClick={() => setFormat('dir')}
              icon={<FolderIcon className="size-4" />}
              title="Directory"
              hint={`skills/${name || 'name'}/SKILL.md`}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A directory can hold supporting files alongside its <code className="font-mono">SKILL.md</code>.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name || create.isPending}>
          {create.isPending ? 'Creating…' : 'Create & edit'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FormatOption({
  active,
  onClick,
  icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col gap-1 rounded-md border p-3 text-left transition-colors',
        active ? 'border-primary bg-accent' : 'hover:bg-accent/50',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="truncate font-mono text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}
