import { slugSchema } from '@mcp-skills/shared';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { FormField } from '@/components/form-field';
import { Code } from '@/components/ui/code';
import { Input } from '@/components/ui/input';
import { useImportGitSkill } from '@/lib/queries';
import { useToasts } from '@/lib/toast';
import { EMPTY_GIT_SOURCE, GitSourceFields, readGitSourceDraft } from './git-source-fields';
import type { UploadStatus } from './upload-skill-dialog';

export const GIT_SKILL_FORM_ID = 'git-skill-form';

/**
 * Create a skill linked to a folder in a git repo: the server fetches the folder and the skill is
 * kept in step with it by syncing. Rendered as a tab inside {@link NewSkillDialog}, which owns the
 * dialog and the footer's submit button (`form={GIT_SKILL_FORM_ID}`); this reports its state through
 * `onStatusChange`, as {@link UploadSkillForm} does.
 */
export function GitSkillForm({
  onStatusChange,
  onImported,
}: {
  onStatusChange: (status: UploadStatus) => void;
  onImported: () => void;
}) {
  const toast = useToasts();
  const navigate = useNavigate();
  const importGit = useImportGitSkill();
  const [draft, setDraft] = useState(EMPTY_GIT_SOURCE);
  const [name, setName] = useState('');

  const { source } = readGitSourceDraft(draft);
  const trimmedName = name.trim();
  const nameValid = trimmedName === '' || slugSchema.safeParse(trimmedName).success;
  const ready = source !== undefined && nameValid;
  const pending = importGit.isPending;
  const dirty = draft.repo !== '' || draft.ref !== '' || draft.path !== '' || name !== '';

  useEffect(() => onStatusChange({ ready, pending, dirty }), [ready, pending, dirty, onStatusChange]);
  // Switching tabs unmounts this form and drops what was typed, so the dialog must stop guarding it.
  useEffect(() => () => onStatusChange({ ready: false, pending: false, dirty: false }), [onStatusChange]);

  const submit = () => {
    if (!source || !nameValid || pending) {
      return;
    }
    importGit.mutate(
      { ...source, ...(trimmedName ? { name: trimmedName } : {}) },
      {
        onSuccess: (skill) => {
          onImported();
          navigate({ to: '/skills/$name', params: { name: skill.name } });
        },
        onError: toast.apiError,
      },
    );
  };

  return (
    <form
      id={GIT_SKILL_FORM_ID}
      className="flex flex-col gap-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Link a skill to a folder in a git repo. Its content comes from the repo, so it is not edited here; sync it to
        pull the newest version.
      </p>
      <GitSourceFields value={draft} onValueChange={setDraft} autoFocus />
      <FormField
        label="Skill id"
        description={
          <>
            Blank uses the <Code>name</Code> in the repo's <Code>SKILL.md</Code>, or the folder's name.
          </>
        }
        error={nameValid ? undefined : 'Must be a lowercase slug (letters, digits, dots, dashes, underscores).'}
        control={<Input value={name} onChange={(event) => setName(event.target.value)} />}
      />
    </form>
  );
}
