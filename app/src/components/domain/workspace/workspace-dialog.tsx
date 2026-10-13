import type { WorkspaceStatus } from '@mcp-skills/shared';
import { InputField, SelectField, SwitchField, TextareaField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { MultiSelectField } from '@/components/multi-select-field';
import type { SelectEntry } from '@/components/option-select';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { FormElement } from '@/components/ui/form-element';
import { useCreateWorkspace, useSkills, useUpdateWorkspace } from '@/lib/queries';
import { SKILL_TOOL_MODE_LABELS, SKILL_TOOL_MODES } from '@/lib/skill-tool-mode';
import { useToasts } from '@/lib/toast';

const WORKSPACE_FORM_ID = 'workspace-form';

/** Sentinel select value meaning "no override — inherit the global setting". */
const INHERIT = 'inherit';

/** The tool-exposure choices: inherit, then every skill-tool mode. */
const TOOL_MODE_OPTIONS: SelectEntry[] = [
  { value: INHERIT, label: 'Inherit global setting' },
  ...SKILL_TOOL_MODES.map((mode) => ({ value: mode, label: SKILL_TOOL_MODE_LABELS[mode] })),
];

/** What a workspace dialog is given. */
interface Props {
  open: boolean;
  /** Called with the state the dialog asks for; `false` on cancel and once the workspace is saved. */
  onOpenChange: (open: boolean) => void;
  /** Provided when editing an existing workspace; omitted when creating. */
  workspace?: WorkspaceStatus;
}

/**
 * Checks that a workspace name was typed.
 *
 * @param field - The field's state.
 * @param field.value - The name as typed.
 * @returns The error to show, or `undefined` when the name is not blank.
 */
export function requireWorkspaceName({ value }: { value: string }): string | undefined {
  return value.trim() ? undefined : 'Give the workspace a name.';
}

/** The dialog that creates or edits a workspace: name, description, enabled flag, tool exposure and member skills. */
export function WorkspaceDialog({ open, onOpenChange, workspace }: Props) {
  const toast = useToasts();
  const isEdit = Boolean(workspace);
  const { data: skills } = useSkills();
  const createWorkspace = useCreateWorkspace();
  const updateWorkspace = useUpdateWorkspace(workspace?.slug ?? '');

  // `inherit` (no override) vs a concrete skill-tool mode for this workspace's endpoint.
  const initialToolMode: string = workspace?.skillToolMode ?? INHERIT;
  const form = useAppForm({
    defaultValues: {
      name: workspace?.name ?? '',
      description: workspace?.description ?? '',
      enabled: workspace?.enabled ?? true,
      toolMode: initialToolMode,
      skills: workspace?.skills ?? [],
    },
    onSubmit: async ({ value }) => {
      // The sentinel is not a mode, so it finds none: no override.
      const mode = SKILL_TOOL_MODES.find((candidate) => candidate === value.toolMode);
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
        toast.apiError(error);
      }
    },
  });

  return (
    <form.AppForm>
      <DialogLayout
        open={open}
        onOpenChange={onOpenChange}
        title={isEdit ? `Edit workspace "${workspace?.name}"` : 'New workspace'}
        description={
          <>
            A workspace serves a chosen subset of skills at its own endpoint <Code>/mcp/w/&lt;slug&gt;</Code>.
          </>
        }
        hasUnsavedChanges={() => form.state.isDefaultValue === false}
        contentSlot={
          <FormElement id={WORKSPACE_FORM_ID} className="min-w-0 gap-4 py-1" onSubmit={() => void form.handleSubmit()}>
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
                    URL: <Code>{workspace?.path}</Code> (renaming re-derives the slug)
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
            <MultiSelectField
              form={form}
              name="skills"
              label="Skills"
              description="The skills this workspace’s endpoint serves."
              placeholder="Select skills…"
              searchPlaceholder="Search skills…"
              searchLabel="Search skills"
              popoverLabel="Skills"
              emptyMessage="No skills to add yet."
              options={(skills ?? []).map((skill) => ({
                value: skill.name,
                label: skill.name,
                hint: skill.description || undefined,
              }))}
            />
          </FormElement>
        }
        footerActionsSlot={(close) => (
          <>
            <Button type="button" variant="outline" onClick={close} content="Cancel" />
            <form.SubmitButton form={WORKSPACE_FORM_ID} pendingLabel="Saving…" content={isEdit ? 'Save' : 'Create'} />
          </>
        )}
      />
    </form.AppForm>
  );
}
