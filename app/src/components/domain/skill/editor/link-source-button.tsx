import type { SkillDetail } from '@mcp-skills/shared';
import { useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { useAppForm } from '@/components/app-form';
import { GitBranch } from '@/components/app-icons';
import { DialogLayout } from '@/components/dialog-layout';
import { EMPTY_GIT_SOURCE, GitSourceFields, readGitSourceDraft } from '@/components/domain/skill/git-source-fields';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { useLinkSkillSource } from '@/lib/queries';
import { useToasts } from '@/lib/toast';

const LINK_SOURCE_FORM_ID = 'link-source-form';

/**
 * The button that links an existing skill to a folder in a git repo, replacing its content from it.
 * @param props.skill - The skill to link.
 */
export function LinkSourceButton({ skill }: { skill: SkillDetail }) {
  const toast = useToasts();
  const link = useLinkSkillSource(skill.name);
  const [open, setOpen] = useState(false);
  const form = useAppForm({
    defaultValues: { source: EMPTY_GIT_SOURCE },
    onSubmit: async ({ value }) => {
      const { source } = readGitSourceDraft(value.source);
      if (!source) {
        return;
      }
      try {
        await link.mutateAsync(source);
        toast.success('Linked — content replaced from the repo');
        handleOpenChange(false);
      } catch (error) {
        toast.apiError(error);
      }
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      form.reset();
    }
    setOpen(next);
  };

  return (
    <form.AppForm>
      <ActionButton
        variant="ghost"
        size="icon-sm"
        label="Link to Git source"
        onClick={() => setOpen(true)}
        iconSlot={<GitBranch />}
      />
      <DialogLayout
        open={open}
        onOpenChange={handleOpenChange}
        title="Link to Git source"
        description="Point this skill at a folder in a git repo and keep it in step by syncing."
        hasUnsavedChanges={() => form.state.isDefaultValue === false}
        contentSlot={
          <FormElement id={LINK_SOURCE_FORM_ID} className="gap-4 py-1" onSubmit={() => void form.handleSubmit()}>
            <Alert
              variant="warning"
              title={`The content of "${skill.name}" is replaced`}
              description="Its Markdown and every supporting file are swapped for the folder in the repo, and it can no longer be edited here or by agents while linked. Its id, workspaces and settings are kept. Export a .zip first to keep a copy."
            />
            <GitSourceFields form={form} autoFocus />
          </FormElement>
        }
        footerActionsSlot={(close) => (
          <>
            <Button type="button" variant="outline" onClick={close} content="Cancel" />
            <form.Subscribe selector={(state) => readGitSourceDraft(state.values.source).source === undefined}>
              {(hasNoSource) => (
                <form.SubmitButton
                  form={LINK_SOURCE_FORM_ID}
                  disabled={hasNoSource}
                  pendingLabel="Fetching…"
                  content="Link & replace"
                  iconSlot={<GitBranch />}
                />
              )}
            </form.Subscribe>
          </>
        )}
      />
    </form.AppForm>
  );
}
