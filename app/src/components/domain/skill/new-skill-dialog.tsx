import type { SkillFormat } from '@mcp-skills/shared';
import { slugify } from '@mcp-skills/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { InputField, TextareaField, useAppForm } from '@/components/app-form';
import { GitBranch } from '@/components/app-icons';
import { DialogLayout } from '@/components/dialog-layout';
import { RadioGroupField } from '@/components/radio-group-field';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { FormElement } from '@/components/ui/form-element';
import { FileText, Folder, Upload } from '@/components/ui/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isKeyOf } from '@/lib/is-key-of';
import { useCreateSkill } from '@/lib/queries';
import { useToasts } from '@/lib/toast';
import { GIT_SKILL_FORM_ID, GitSkillForm } from './git-skill-form';
import { IDLE_IMPORT, type ImportStatus } from './import-status';
import { UPLOAD_SKILL_FORM_ID, UploadSkillForm } from './upload-skill-form';

const CREATE_SKILL_FORM_ID = 'create-skill-form';

/** The dialog's tabs, with the label each shows. */
const TAB_LABELS = { create: 'Create skill', upload: 'Upload', git: 'From Git' } as const;
/** One of the dialog's tabs. */
type Tab = keyof typeof TAB_LABELS;

/** What the create form starts with. */
const CREATE_DEFAULTS: { title: string; description: string; format: SkillFormat } = {
  title: '',
  description: '',
  format: 'file',
};

/**
 * Checks that a title slugifies to a usable skill id.
 *
 * @param field - The field's state.
 * @param field.value - The title as typed.
 * @returns The error to show, or `undefined` when the title yields an id.
 */
export function validateSkillTitle({ value }: { value: string }): string | undefined {
  return slugify(value) ? undefined : 'Enter a title with at least one letter or digit.';
}

/**
 * New-skill dialog with three tabs: author one from scratch (title + description, then open the
 * editor), upload an existing file/folder/`.zip`, or link one to a folder in a git repo.
 */
export function NewSkillDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  /** Called with the state the dialog asks for; `false` on cancel and once a skill has been made. */
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToasts();
  const navigate = useNavigate();
  const create = useCreateSkill();
  const [tab, setTab] = useState<Tab>('create');
  const [upload, setUpload] = useState<ImportStatus>(IDLE_IMPORT);
  const [git, setGit] = useState<ImportStatus>(IDLE_IMPORT);

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

  // For a caller that keeps the dialog mounted while closed: the next opening starts over on the create tab.
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
        hasUnsavedChanges={() => form.state.isDefaultValue === false || upload.dirty || git.dirty}
        contentSlot={
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
              <FormElement id={CREATE_SKILL_FORM_ID} className="gap-4 py-4" onSubmit={() => void form.handleSubmit()}>
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
                            iconSlot: <FileText className="size-4" />,
                            description: `skills/${name || 'name'}.md`,
                          },
                          {
                            value: 'dir',
                            label: 'Directory',
                            iconSlot: <Folder className="size-4" />,
                            description: `skills/${name || 'name'}/SKILL.md`,
                          },
                        ]}
                      />
                    </>
                  )}
                </form.Subscribe>
              </FormElement>
            </TabsContent>
            <TabsContent value="upload">
              <UploadSkillForm onStatusChange={setUpload} onImported={() => handleOpenChange(false)} />
            </TabsContent>
            <TabsContent value="git">
              <GitSkillForm onStatusChange={setGit} onImported={() => handleOpenChange(false)} />
            </TabsContent>
          </Tabs>
        }
        footerActionsSlot={(close) => (
          <>
            <Button type="button" variant="outline" onClick={close} content="Cancel" />
            {tab === 'create' && (
              <form.SubmitButton form={CREATE_SKILL_FORM_ID} pendingLabel="Creating…" content="Create & edit" />
            )}
            {tab === 'upload' && (
              <Button
                type="submit"
                form={UPLOAD_SKILL_FORM_ID}
                disabled={!upload.ready || upload.pending}
                content={upload.pending ? 'Importing…' : 'Import skill'}
                iconSlot={<Upload />}
              />
            )}
            {tab === 'git' && (
              <Button
                type="submit"
                form={GIT_SKILL_FORM_ID}
                disabled={!git.ready || git.pending}
                content={git.pending ? 'Fetching…' : 'Link skill'}
                iconSlot={<GitBranch />}
              />
            )}
          </>
        )}
      />
    </form.AppForm>
  );
}
