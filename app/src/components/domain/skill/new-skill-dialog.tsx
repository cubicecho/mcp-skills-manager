import { slugifySkillName } from '@mcp-skills/shared';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { useCreateSkill } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

/** Create a skill from a title (which becomes the slug) + one-line description. Opens the editor on success. */
export function NewSkillDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const create = useCreateSkill();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const name = slugifySkillName(title);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name) {
      return;
    }
    create.mutate(
      { title, description, body: `# ${title || name}\n\n` },
      {
        onSuccess: (skill) => {
          onOpenChange(false);
          setTitle('');
          setDescription('');
          navigate({ to: '/skills/$name', params: { name: skill.name } });
        },
        onError: toastApiError,
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New skill</DialogTitle>
            <DialogDescription>
              A skill is a Markdown document agents can load over MCP. You'll edit its content next.
            </DialogDescription>
          </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}
