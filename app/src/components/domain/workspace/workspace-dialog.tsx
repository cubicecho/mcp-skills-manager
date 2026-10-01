import type { SkillToolMode, WorkspaceStatus } from '@mcp-skills/shared';
import { useStore } from '@tanstack/react-form';
import { InputField, SelectField, SwitchField, TextareaField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { FormField } from '@/components/form-field';
import type { SelectEntry } from '@/components/option-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useCreateWorkspace, useSkills, useUpdateWorkspace } from '@/lib/queries';
import { SKILL_TOOL_MODE_LABELS, SKILL_TOOL_MODES } from '@/lib/skill-tool-mode';
import { toastApiError } from '@/lib/toast';

const WORKSPACE_FORM_ID = 'workspace-form';

/** Sentinel select value meaning "no override — inherit the global setting". */
const INHERIT = 'inherit';

const TOOL_MODE_OPTIONS: SelectEntry[] = [
  { value: INHERIT, label: 'Inherit global setting' },
  ...SKILL_TOOL_MODES.map((mode) => ({ value: mode, label: SKILL_TOOL_MODE_LABELS[mode] })),
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Provided when editing an existing workspace; omitted when creating. */
  workspace?: WorkspaceStatus;
}

export function requireWorkspaceName({ value }: { value: string }): string | undefined {
  return value.trim() ? undefined : 'Give the workspace a name.';
}

/** Create or edit a workspace: name, description, enabled flag, and the member skill set. */
export function WorkspaceDialog({ open, onOpenChange, workspace }: Props) {
  const isEdit = Boolean(workspace);
  const { data: skills } = useSkills();
  const createWorkspace = useCreateWorkspace();
  const updateWorkspace = useUpdateWorkspace(workspace?.slug ?? '');

  const form = useAppForm({
    defaultValues: {
      name: workspace?.name ?? '',
      description: workspace?.description ?? '',
      enabled: workspace?.enabled ?? true,
      // `inherit` (no override) vs a concrete skill-tool mode for this workspace's endpoint.
      toolMode: (workspace?.skillToolMode ?? INHERIT) as string,
      skills: workspace?.skills ?? [],
    },
    onSubmit: async ({ value }) => {
      const mode = value.toolMode === INHERIT ? undefined : (value.toolMode as SkillToolMode);
      const body = { name: value.name, description: value.description, enabled: value.enabled, skills: value.skills };
      try {
        if (isEdit) {
          // null clears the override (inherit); a value sets it.
          await updateWorkspace.mutateAsync({ ...body, skillToolMode: mode ?? null });
        } else {
          await createWorkspace.mutateAsync({ ...body, skillToolMode: mode });
        }
        onOpenChange(false);
      } catch (error) {
        toastApiError(error);
      }
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);

  return (
    <form.AppForm>
      <DialogLayout
        open={open}
        onOpenChange={onOpenChange}
        title={isEdit ? `Edit workspace "${workspace?.name}"` : 'New workspace'}
        description={
          <>
            A workspace serves a chosen subset of skills at its own endpoint <code>/mcp/w/&lt;slug&gt;</code>.
          </>
        }
        hasUnsavedChanges={isDirty}
        content={
          <form
            id={WORKSPACE_FORM_ID}
            className="flex min-w-0 flex-col gap-4 py-1"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <InputField
              form={form}
              name="name"
              label="Name"
              required
              autoFocus
              placeholder="Backend"
              validators={{ onChange: requireWorkspaceName, onSubmit: requireWorkspaceName }}
              description={
                isEdit ? (
                  <>
                    URL: <code className="font-mono">{workspace?.path}</code> (renaming re-derives the slug)
                  </>
                ) : undefined
              }
            />
            <TextareaField
              form={form}
              name="description"
              label="Description"
              placeholder="Optional summary of what this workspace is for."
              rows={2}
            />
            <SwitchField
              form={form}
              name="enabled"
              label="Enabled"
              description="Disabled workspaces 404 their endpoint."
            />
            <SelectField
              form={form}
              name="toolMode"
              label="MCP tool exposure"
              options={TOOL_MODE_OPTIONS}
              description="How this workspace’s endpoint advertises skills as tools. Inherit uses the global default from Settings."
            />
            <form.Field name="skills">
              {(field) => (
                <FormField
                  asGroup
                  label={`Skills (${field.state.value.length} selected)`}
                  control={(wired) => (
                    <fieldset
                      {...wired}
                      className="flex max-h-56 min-w-0 flex-col gap-1 overflow-y-auto rounded-md border p-1"
                    >
                      {skills && skills.length > 0 ? (
                        skills.map((skill) => {
                          const checked = field.state.value.includes(skill.name);
                          const checkboxId = `workspace-skill-${skill.name}`;
                          return (
                            <label
                              key={skill.name}
                              htmlFor={checkboxId}
                              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                            >
                              <Checkbox
                                id={checkboxId}
                                className="mt-0.5"
                                checked={checked}
                                onCheckedChange={(next) =>
                                  field.handleChange(
                                    next === true
                                      ? [...field.state.value, skill.name]
                                      : field.state.value.filter((member) => member !== skill.name),
                                  )
                                }
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium">{skill.name}</span>
                                {skill.description && (
                                  <span className="block break-words text-xs text-muted-foreground">
                                    {skill.description}
                                  </span>
                                )}
                              </span>
                            </label>
                          );
                        })
                      ) : (
                        <p className="px-2 py-4 text-center text-sm text-muted-foreground">No skills to add yet.</p>
                      )}
                    </fieldset>
                  )}
                />
              )}
            </form.Field>
          </form>
        }
        footerActions={(close) => (
          <>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <form.SubmitButton form={WORKSPACE_FORM_ID} pendingLabel="Saving…">
              {isEdit ? 'Save' : 'Create'}
            </form.SubmitButton>
          </>
        )}
      />
    </form.AppForm>
  );
}
