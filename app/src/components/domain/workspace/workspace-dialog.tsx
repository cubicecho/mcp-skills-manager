import type { SkillToolMode, WorkspaceStatus } from '@mcp-skills/shared';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useCreateWorkspace, useSkills, useUpdateWorkspace } from '@/lib/queries';
import { SKILL_TOOL_MODE_LABELS, SKILL_TOOL_MODES } from '@/lib/skill-tool-mode';
import { toastApiError } from '@/lib/toast';

/** Sentinel select value meaning "no override — inherit the global setting". */
const INHERIT = 'inherit';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Provided when editing an existing workspace; omitted when creating. */
  workspace?: WorkspaceStatus;
}

/** Create or edit a workspace: name, description, enabled flag, and the member skill set. */
export function WorkspaceDialog({ open, onOpenChange, workspace }: Props) {
  const isEdit = Boolean(workspace);
  const { data: skills } = useSkills();
  const createWorkspace = useCreateWorkspace();
  const updateWorkspace = useUpdateWorkspace(workspace?.slug ?? '');
  const pending = createWorkspace.isPending || updateWorkspace.isPending;

  const [name, setName] = useState(workspace?.name ?? '');
  const [description, setDescription] = useState(workspace?.description ?? '');
  const [enabled, setEnabled] = useState(workspace?.enabled ?? true);
  const [members, setMembers] = useState<Set<string>>(new Set(workspace?.skills ?? []));
  // `inherit` (no override) vs a concrete skill-tool mode for this workspace's endpoint.
  const [toolMode, setToolMode] = useState<SkillToolMode | typeof INHERIT>(workspace?.skillToolMode ?? INHERIT);

  const toggle = (skill: string) => {
    setMembers((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) {
        next.delete(skill);
      } else {
        next.add(skill);
      }
      return next;
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    const skillList = [...members];
    const onSuccess = () => onOpenChange(false);
    if (isEdit && workspace) {
      // null clears the override (inherit); a value sets it.
      const skillToolMode = toolMode === INHERIT ? null : toolMode;
      updateWorkspace.mutate(
        { name, description, enabled, skills: skillList, skillToolMode },
        { onSuccess, onError: toastApiError },
      );
    } else {
      const skillToolMode = toolMode === INHERIT ? undefined : toolMode;
      createWorkspace.mutate(
        { name, description, enabled, skills: skillList, skillToolMode },
        { onSuccess, onError: toastApiError },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? `Edit workspace "${workspace?.name}"` : 'New workspace'}</DialogTitle>
            <DialogDescription>
              A workspace serves a chosen subset of skills at its own endpoint <code>/mcp/w/&lt;slug&gt;</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-w-0 flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="workspace-name">Name</Label>
              <Input
                id="workspace-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Backend"
              />
              {isEdit && (
                <p className="text-xs text-muted-foreground">
                  URL: <code className="font-mono">{workspace?.path}</code> (renaming re-derives the slug)
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="workspace-description">Description</Label>
              <Textarea
                id="workspace-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional summary of what this workspace is for."
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="workspace-enabled">Enabled</Label>
                <p className="text-xs text-muted-foreground">Disabled workspaces 404 their endpoint.</p>
              </div>
              <Switch id="workspace-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="workspace-tool-mode">MCP tool exposure</Label>
              <Select value={toolMode} onValueChange={(value) => setToolMode(value as SkillToolMode | typeof INHERIT)}>
                <SelectTrigger id="workspace-tool-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>Inherit global setting</SelectItem>
                  {SKILL_TOOL_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {SKILL_TOOL_MODE_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                How this workspace’s endpoint advertises skills as tools. Inherit uses the global default from Settings.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Skills ({members.size} selected)</Label>
              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-1">
                {skills && skills.length > 0 ? (
                  skills.map((skill) => (
                    <label
                      key={skill.name}
                      className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={members.has(skill.name)}
                        onChange={() => toggle(skill.name)}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{skill.name}</span>
                        {skill.description && (
                          <span className="block break-words text-xs text-muted-foreground">{skill.description}</span>
                        )}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="px-2 py-4 text-center text-sm text-muted-foreground">No skills to add yet.</p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
