import { type SkillDetail, slugSchema } from '@mcp-skills/shared';
import { useState } from 'react';
import { PathPromptDialog } from '@/components/domain/skill/path-prompt-dialog';
import { Button } from '@/components/ui/button';
import { Pencil } from '@/components/ui/icons';
import { useUpdateSkill } from '@/lib/queries';
import { reported } from '@/lib/reported';
import { useToasts } from '@/lib/toast';

/** The button that renames a skill through a prompt dialog. */
export function RenameButton({
  skill,
  onRenamed,
}: {
  /** The skill to rename. */
  skill: SkillDetail;
  /** Called with the new name once the rename has been saved. */
  onRenamed: (name: string) => void;
}) {
  const toast = useToasts();
  const update = useUpdateSkill(skill.name);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Rename skill"
        onClick={() => setOpen(true)}
        iconSlot={<Pencil />}
      />
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
