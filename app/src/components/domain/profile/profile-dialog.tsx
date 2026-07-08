import type { ProfileStatus, SkillToolMode } from '@mcp-skills/shared';
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
import { useCreateProfile, useSkills, useUpdateProfile } from '@/lib/queries';
import { SKILL_TOOL_MODE_LABELS } from '@/lib/skill-tool-mode';
import { toastApiError } from '@/lib/toast';

/** Sentinel select value meaning "no override — inherit the global setting". */
const INHERIT = 'inherit';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Provided when editing an existing profile; omitted when creating. */
  profile?: ProfileStatus;
}

/** Create or edit a profile: name, description, enabled flag, and the member skill set. */
export function ProfileDialog({ open, onOpenChange, profile }: Props) {
  const isEdit = Boolean(profile);
  const { data: skills } = useSkills();
  const createProfile = useCreateProfile();
  const updateProfile = useUpdateProfile(profile?.slug ?? '');
  const pending = createProfile.isPending || updateProfile.isPending;

  const [name, setName] = useState(profile?.name ?? '');
  const [description, setDescription] = useState(profile?.description ?? '');
  const [enabled, setEnabled] = useState(profile?.enabled ?? true);
  const [members, setMembers] = useState<Set<string>>(new Set(profile?.skills ?? []));
  // `inherit` (no override) vs a concrete skill-tool mode for this profile's endpoint.
  const [toolMode, setToolMode] = useState<SkillToolMode | typeof INHERIT>(profile?.skillToolMode ?? INHERIT);

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
    if (isEdit && profile) {
      // null clears the override (inherit); a value sets it.
      const skillToolMode = toolMode === INHERIT ? null : toolMode;
      updateProfile.mutate(
        { name, description, enabled, skills: skillList, skillToolMode },
        { onSuccess, onError: toastApiError },
      );
    } else {
      const skillToolMode = toolMode === INHERIT ? undefined : toolMode;
      createProfile.mutate(
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
            <DialogTitle>{isEdit ? `Edit profile "${profile?.name}"` : 'New profile'}</DialogTitle>
            <DialogDescription>
              A profile serves a chosen subset of skills at its own endpoint <code>/mcp/p/&lt;slug&gt;</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-w-0 flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Backend"
              />
              {isEdit && (
                <p className="text-xs text-muted-foreground">
                  URL: <code className="font-mono">{profile?.path}</code> (renaming re-derives the slug)
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-description">Description</Label>
              <Textarea
                id="profile-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional summary of what this profile is for."
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="profile-enabled">Enabled</Label>
                <p className="text-xs text-muted-foreground">Disabled profiles 404 their endpoint.</p>
              </div>
              <Switch id="profile-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-tool-mode">MCP tool exposure</Label>
              <Select value={toolMode} onValueChange={(value) => setToolMode(value as SkillToolMode | typeof INHERIT)}>
                <SelectTrigger id="profile-tool-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>Inherit global setting</SelectItem>
                  <SelectItem value="per-skill">{SKILL_TOOL_MODE_LABELS['per-skill']}</SelectItem>
                  <SelectItem value="loader">{SKILL_TOOL_MODE_LABELS.loader}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                How this profile’s endpoint advertises skills as tools. Inherit uses the global default from Settings.
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
