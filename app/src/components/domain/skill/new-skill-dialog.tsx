import type { SkillFormat } from '@mcp-skills/shared';
import { slugifySkillName } from '@mcp-skills/shared';
import { useStore } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { FileTextIcon, FolderIcon, UploadIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { InputField, TextareaField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCreateSkill } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { UPLOAD_SKILL_FORM_ID, UploadSkillForm, type UploadStatus } from './upload-skill-dialog';

const CREATE_SKILL_FORM_ID = 'create-skill-form';

type Tab = 'create' | 'upload';

const IDLE_UPLOAD: UploadStatus = { ready: false, pending: false, dirty: false };

/** A title must slugify to a usable skill id. */
export function validateSkillTitle({ value }: { value: string }): string | undefined {
  return slugifySkillName(value) ? undefined : 'Enter a title with at least one letter or digit.';
}

/**
 * New-skill dialog with two tabs: author one from scratch (title + description, then open the
 * editor), or upload an existing file/folder/`.zip`.
 */
export function NewSkillDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const create = useCreateSkill();
  const [tab, setTab] = useState<Tab>('create');
  const [upload, setUpload] = useState<UploadStatus>(IDLE_UPLOAD);

  const form = useAppForm({
    defaultValues: { title: '', description: '', format: 'file' as SkillFormat },
    onSubmit: async ({ value }) => {
      const name = slugifySkillName(value.title);
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
        toastApiError(error);
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
        description="A skill is a Markdown document agents can load over MCP. Create one from scratch or upload an existing one."
        hasUnsavedChanges={isDirty || upload.dirty}
        content={
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
            <TabsList className="w-full">
              <TabsTrigger value="create">Create skill</TabsTrigger>
              <TabsTrigger value="upload">Upload</TabsTrigger>
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
                <form.Subscribe selector={(state) => slugifySkillName(state.values.title)}>
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
                              Skill id: <code className="font-mono">{name}</code>
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
                      <form.Field name="format">
                        {(field) => (
                          <FormField
                            asGroup
                            label="Layout"
                            description={
                              <>
                                A directory can hold supporting files alongside its{' '}
                                <code className="font-mono">SKILL.md</code>.
                              </>
                            }
                            control={(wired) => (
                              <fieldset {...wired} className="grid min-w-0 grid-cols-2 gap-2">
                                <FormatOption
                                  active={field.state.value === 'file'}
                                  onClick={() => field.handleChange('file')}
                                  icon={<FileTextIcon className="size-4" />}
                                  title="Single file"
                                  hint={`skills/${name || 'name'}.md`}
                                />
                                <FormatOption
                                  active={field.state.value === 'dir'}
                                  onClick={() => field.handleChange('dir')}
                                  icon={<FolderIcon className="size-4" />}
                                  title="Directory"
                                  hint={`skills/${name || 'name'}/SKILL.md`}
                                />
                              </fieldset>
                            )}
                          />
                        )}
                      </form.Field>
                    </>
                  )}
                </form.Subscribe>
              </form>
            </TabsContent>
            <TabsContent value="upload">
              <UploadSkillForm onStatusChange={setUpload} onImported={() => handleOpenChange(false)} />
            </TabsContent>
          </Tabs>
        }
        footerActions={(close) => (
          <>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            {tab === 'create' ? (
              <form.SubmitButton form={CREATE_SKILL_FORM_ID} pendingLabel="Creating…">
                Create &amp; edit
              </form.SubmitButton>
            ) : (
              <Button type="submit" form={UPLOAD_SKILL_FORM_ID} disabled={!upload.ready || upload.pending}>
                <UploadIcon /> {upload.pending ? 'Importing…' : 'Import skill'}
              </Button>
            )}
          </>
        )}
      />
    </form.AppForm>
  );
}

function FormatOption({
  active,
  onClick,
  icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col gap-1 rounded-md border p-3 text-left transition-colors',
        active ? 'border-primary bg-accent' : 'hover:bg-accent/50',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="truncate font-mono text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}
