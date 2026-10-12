import type { SkillFormat } from '@mcp-skills/shared';
import { slugify } from '@mcp-skills/shared';
import { useStore } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { InputField, TextareaField, useAppForm } from '@/components/app-form';
import { GitBranch } from '@/components/app-icons';
import { DialogLayout } from '@/components/dialog-layout';
import { RadioGroupField } from '@/components/radio-group-field';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { FileText, Folder, Upload } from '@/components/ui/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isKeyOf } from '@/lib/is-key-of';
import { useCreateSkill } from '@/lib/queries';
import { useToasts } from '@/lib/toast';
import { GIT_SKILL_FORM_ID, GitSkillForm } from './git-skill-form';
import { UPLOAD_SKILL_FORM_ID, UploadSkillForm, type UploadStatus } from './upload-skill-dialog';

const CREATE_SKILL_FORM_ID = 'create-skill-form';

/** The dialog's tabs, with the label each shows. */
const TAB_LABELS = { create: 'Create skill', upload: 'Upload', git: 'From Git' } as const;
type Tab = keyof typeof TAB_LABELS;

/** What the create form starts with. */
const CREATE_DEFAULTS: { title: string; description: string; format: SkillFormat } = {
  title: '',
  description: '',
  format: 'file',
};

const IDLE_UPLOAD: UploadStatus = { ready: false, pending: false, dirty: false };

/** A title must slugify to a usable skill id. */
export function validateSkillTitle({ value }: { value: string }): string | undefined {
  return slugify(value) ? undefined : 'Enter a title with at least one letter or digit.';
}

/**
 * New-skill dialog with three tabs: author one from scratch (title + description, then open the
 * editor), upload an existing file/folder/`.zip`, or link one to a folder in a git repo.
 */
export function NewSkillDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToasts();
  const navigate = useNavigate();
  const create = useCreateSkill();
  const [tab, setTab] = useState<Tab>('create');
  const [upload, setUpload] = useState<UploadStatus>(IDLE_UPLOAD);
  const [git, setGit] = useState<UploadStatus>(IDLE_UPLOAD);

  const form = useAppForm({
    defaultValues: CREATE_DEFAULTS,
    onSubmit: async ({ value }) => {
      const name = slugify(value.title);
      try {
        const skill = await create.mutateAsync({
          title: value.title,
          description: value.description,
          format: value.format,
          body: `# ${value.title || name}\n\n`,
        });
        handleOpenChange(false);
        navigate({ to: '/skills/$name', params: { name: skill.name } });
      } catch (error) {
        toast.apiError(error);
      }
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);

  // The dialog stays mounted between openings, so a closed one starts over on the create tab.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      form.reset();
      setTab('create');
    }
    onOpenChange(next);
  };

  return (
    <form.AppForm>
      <DialogLayout
        open={open}
        onOpenChange={handleOpenChange}
        title="New skill"
        description="A skill is a Markdown document agents can load over MCP. Create one from scratch, upload an existing one, or link one to a git repo."
        hasUnsavedChanges={isDirty || upload.dirty || git.dirty}
        content={
          <Tabs
            value={tab}
            onValueChange={(value) => {
              if (isKeyOf(TAB_LABELS, value)) {
                setTab(value);
              }
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="create">{TAB_LABELS.create}</TabsTrigger>
              <TabsTrigger value="upload">{TAB_LABELS.upload}</TabsTrigger>
              <TabsTrigger value="git">{TAB_LABELS.git}</TabsTrigger>
            </TabsList>
            <TabsContent value="create">
              <form
                id={CREATE_SKILL_FORM_ID}
                className="flex flex-col gap-4 py-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void form.handleSubmit();
                }}
              >
                <form.Subscribe selector={(state) => slugify(state.values.title)}>
                  {(name) => (
                    <>
                      <InputField
                        form={form}
                        name="title"
                        label="Title"
                        required
                        autoFocus
                        placeholder="Deploy to production"
                        validators={{ onChange: validateSkillTitle, onSubmit: validateSkillTitle }}
                        description={
                          name ? (
                            <>
                              Skill id: <Code>{name}</Code>
                            </>
                          ) : undefined
                        }
                      />
                      <TextareaField
                        form={form}
                        name="description"
                        label="Description"
                        placeholder="One line telling the agent when to use this skill."
                        rows={2}
                      />
                      <RadioGroupField
                        form={form}
                        name="format"
                        label="Layout"
                        variant="card"
                        description={
                          <>
                            A directory can hold supporting files alongside its <Code>SKILL.md</Code>.
                          </>
                        }
                        options={[
                          {
                            value: 'file',
                            label: 'Single file',
                            icon: <FileText className="size-4" />,
                            description: `skills/${name || 'name'}.md`,
                          },
                          {
                            value: 'dir',
                            label: 'Directory',
                            icon: <Folder className="size-4" />,
                            description: `skills/${name || 'name'}/SKILL.md`,
                          },
                        ]}
                      />
                    </>
                  )}
                </form.Subscribe>
              </form>
            </TabsContent>
            <TabsContent value="upload">
              <UploadSkillForm onStatusChange={setUpload} onImported={() => handleOpenChange(false)} />
            </TabsContent>
            <TabsContent value="git">
              <GitSkillForm onStatusChange={setGit} onImported={() => handleOpenChange(false)} />
            </TabsContent>
          </Tabs>
        }
        footerActions={(close) => (
          <>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            {tab === 'create' && (
              <form.SubmitButton form={CREATE_SKILL_FORM_ID} pendingLabel="Creating…">
                Create &amp; edit
              </form.SubmitButton>
            )}
            {tab === 'upload' && (
              <Button type="submit" form={UPLOAD_SKILL_FORM_ID} disabled={!upload.ready || upload.pending}>
                <Upload /> {upload.pending ? 'Importing…' : 'Import skill'}
              </Button>
            )}
            {tab === 'git' && (
              <Button type="submit" form={GIT_SKILL_FORM_ID} disabled={!git.ready || git.pending}>
                <GitBranch /> {git.pending ? 'Fetching…' : 'Link skill'}
              </Button>
            )}
          </>
        )}
      />
    </form.AppForm>
  );
}
