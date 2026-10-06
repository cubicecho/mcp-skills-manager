import type { SkillDetail } from '@mcp-skills/shared';
import { useStore } from '@tanstack/react-form';
import { useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { useAppForm } from '@/components/app-form';
import { GitBranch } from '@/components/app-icons';
import { DialogLayout } from '@/components/dialog-layout';
import { EMPTY_GIT_SOURCE, GitSourceFields, readGitSourceDraft } from '@/components/domain/skill/git-source-fields';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
    onSubmit: ({ value }) => {
      const { source } = readGitSourceDraft(value.source);
      if (!source || link.isPending) {
        return;
      }
      link.mutate(source, {
        onSuccess: () => {
          toast.success('Linked — content replaced from the repo');
          handleOpenChange(false);
        },
        onError: toast.apiError,
      });
    },
  });
  const hasNoSource = useStore(form.store, (state) => readGitSourceDraft(state.values.source).source === undefined);
  const isUnchanged = useStore(form.store, (state) => state.isDefaultValue);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      form.reset();
    }
    setOpen(next);
  };

  return (
    <form.AppForm>
      <ActionButton variant="ghost" size="icon-sm" label="Link to Git source" onClick={() => setOpen(true)}>
        <GitBranch />
      </ActionButton>
      <DialogLayout
        open={open}
        onOpenChange={handleOpenChange}
        title="Link to Git source"
        description="Point this skill at a folder in a git repo and keep it in step by syncing."
        hasUnsavedChanges={isUnchanged === false}
        content={
          <form
            id={LINK_SOURCE_FORM_ID}
            className="flex flex-col gap-4 py-1"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <Alert
              variant="warning"
              title={`The content of "${skill.name}" is replaced`}
              description="Its Markdown and every supporting file are swapped for the folder in the repo, and it can no longer be edited here or by agents while linked. Its id, workspaces and settings are kept. Export a .zip first to keep a copy."
            />
            <GitSourceFields form={form} fields="source" autoFocus />
          </form>
        }
        footerActions={(close) => (
          <>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <form.SubmitButton form={LINK_SOURCE_FORM_ID} disabled={hasNoSource || link.isPending}>
              <GitBranch /> {link.isPending ? 'Fetching…' : 'Link & replace'}
            </form.SubmitButton>
          </>
        )}
      />
    </form.AppForm>
  );
}
