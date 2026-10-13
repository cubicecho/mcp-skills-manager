import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { InputField, useAppForm } from '@/components/app-form';
import { Code } from '@/components/ui/code';
import { FormElement } from '@/components/ui/form-element';
import { useFormStore } from '@/lib/form-store';
import { useImportGitSkill } from '@/lib/queries';
import { useToasts } from '@/lib/toast';
import { EMPTY_GIT_SOURCE, GitSourceFields, readGitSourceDraft } from './git-source-fields';
import { IDLE_IMPORT, type ImportStatus, validateSkillId } from './import-status';

/** The form's id, which the dialog's submit button names. */
export const GIT_SKILL_FORM_ID = 'git-skill-form';

/**
 * Checks an optional skill id typed into a form.
 *
 * @param field - The field's state.
 * @param field.value - The id as typed.
 * @returns The error to show, or `undefined` for a valid slug or a blank id, which lets the repo name the skill.
 */
function validateOptionalSkillId({ value }: { value: string }): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : validateSkillId({ value: trimmed });
}

/**
 * The form that creates a skill linked to a folder in a git repo.
 *
 * @remarks
 * The server fetches the folder, and syncing keeps the skill in step with it. Rendered as a tab inside
 * {@link NewSkillDialog}, which owns the dialog and the footer's submit button (`form={GIT_SKILL_FORM_ID}`);
 * this reports its state through `onStatusChange`, as {@link UploadSkillForm} does.
 */
export function GitSkillForm({
  onStatusChange,
  onImported,
}: {
  /** Called with the form's state whenever it changes, and with `IDLE_IMPORT` when the form unmounts. */
  onStatusChange: (status: ImportStatus) => void;
  /** Called once the skill has been created, before the app goes to it. */
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
  const values = useFormStore(form.store, (state) => state.values);
  const isUnchanged = useFormStore(form.store, (state) => state.isDefaultValue);

  const { source } = readGitSourceDraft(values.source);
  const nameValid = validateOptionalSkillId({ value: values.name }) === undefined;
  const ready = source !== undefined && nameValid;
  const pending = importGit.isPending;
  const dirty = isUnchanged === false;

  useEffect(() => onStatusChange({ ready, pending, dirty }), [ready, pending, dirty, onStatusChange]);
  // Switching tabs unmounts this form and drops what was typed, so the dialog must stop guarding it.
  useEffect(() => () => onStatusChange(IDLE_IMPORT), [onStatusChange]);

  return (
    <FormElement id={GIT_SKILL_FORM_ID} className="gap-4 py-4" onSubmit={() => void form.handleSubmit()}>
      <p className="text-sm text-muted-foreground">
        Link a skill to a folder in a git repo. Its content comes from the repo, so it is not edited here; sync it to
        pull the newest version.
      </p>
      <GitSourceFields form={form} autoFocus />
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
    </FormElement>
  );
}
