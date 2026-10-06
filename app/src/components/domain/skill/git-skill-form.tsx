import { useStore } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { InputField, useAppForm } from '@/components/app-form';
import { Code } from '@/components/ui/code';
import { useImportGitSkill } from '@/lib/queries';
import { useToasts } from '@/lib/toast';
import { EMPTY_GIT_SOURCE, GitSourceFields, readGitSourceDraft } from './git-source-fields';
import { type UploadStatus, validateSkillId } from './upload-skill-dialog';

export const GIT_SKILL_FORM_ID = 'git-skill-form';

/** A blank id is allowed (the repo names the skill); anything else must be a slug. */
function validateOptionalSkillId({ value }: { value: string }): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : validateSkillId({ value: trimmed });
}

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
  const form = useAppForm({
    defaultValues: { source: EMPTY_GIT_SOURCE, name: '' },
    onSubmit: ({ value }) => {
      const { source } = readGitSourceDraft(value.source);
      const name = value.name.trim();
      if (!source || importGit.isPending) {
        return;
      }
      importGit.mutate(
        { ...source, ...(name ? { name } : {}) },
        {
          onSuccess: (skill) => {
            onImported();
            navigate({ to: '/skills/$name', params: { name: skill.name } });
          },
          onError: toast.apiError,
        },
      );
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const isUnchanged = useStore(form.store, (state) => state.isDefaultValue);

  const { source } = readGitSourceDraft(values.source);
  const nameValid = validateOptionalSkillId({ value: values.name }) === undefined;
  const ready = source !== undefined && nameValid;
  const pending = importGit.isPending;
  const dirty = isUnchanged === false;

  useEffect(() => onStatusChange({ ready, pending, dirty }), [ready, pending, dirty, onStatusChange]);
  // Switching tabs unmounts this form and drops what was typed, so the dialog must stop guarding it.
  useEffect(() => () => onStatusChange({ ready: false, pending: false, dirty: false }), [onStatusChange]);

  return (
    <form
      id={GIT_SKILL_FORM_ID}
      className="flex flex-col gap-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Link a skill to a folder in a git repo. Its content comes from the repo, so it is not edited here; sync it to
        pull the newest version.
      </p>
      <GitSourceFields form={form} fields="source" autoFocus />
      <InputField
        form={form}
        name="name"
        label="Skill id"
        description={
          <>
            Blank uses the <Code>name</Code> in the repo's <Code>SKILL.md</Code>, or the folder's name.
          </>
        }
        validators={{ onChange: validateOptionalSkillId }}
      />
    </form>
  );
}
