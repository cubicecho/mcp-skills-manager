import type { SkillDetail } from '@mcp-skills/shared';
import { useState } from 'react';
import { ActionButton } from '@/components/action-button';
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
  const [draft, setDraft] = useState(EMPTY_GIT_SOURCE);
  const { source } = readGitSourceDraft(draft);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setDraft(EMPTY_GIT_SOURCE);
    }
    setOpen(next);
  };

  const submit = () => {
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
  };

  return (
    <>
      <ActionButton variant="ghost" size="icon-sm" label="Link to Git source" onClick={() => setOpen(true)}>
        <GitBranch />
      </ActionButton>
      <DialogLayout
        open={open}
        onOpenChange={handleOpenChange}
        title="Link to Git source"
        description="Point this skill at a folder in a git repo and keep it in step by syncing."
        hasUnsavedChanges={draft.repo !== '' || draft.ref !== '' || draft.path !== ''}
        content={
          <form
            id={LINK_SOURCE_FORM_ID}
            className="flex flex-col gap-4 py-1"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Alert
              variant="warning"
              title={`The content of "${skill.name}" is replaced`}
              description="Its Markdown and every supporting file are swapped for the folder in the repo, and it can no longer be edited here or by agents while linked. Its id, workspaces and settings are kept. Export a .zip first to keep a copy."
            />
            <GitSourceFields value={draft} onValueChange={setDraft} autoFocus />
          </form>
        }
        footerActions={(close) => (
          <>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form={LINK_SOURCE_FORM_ID} disabled={!source || link.isPending}>
              <GitBranch /> {link.isPending ? 'Fetching…' : 'Link & replace'}
            </Button>
          </>
        )}
      />
    </>
  );
}
