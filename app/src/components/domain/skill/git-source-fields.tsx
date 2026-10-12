import { type GitSource, gitSourceSchema, parseGitSourceUrl } from '@mcp-skills/shared';
import { InputField } from '@/components/app-form';
import { FieldRow } from '@/components/field-row';
import { Code } from '@/components/ui/code';
import type { BindableForm } from '@/lib/form-binding';

/** The three source fields as typed, before validation. */
export interface GitSourceDraft {
  repo: string;
  ref: string;
  path: string;
}

export const EMPTY_GIT_SOURCE: GitSourceDraft = { repo: '', ref: '', path: '' };

/**
 * Validate what was typed into the source fields.
 * @param draft - The fields as typed; an empty ref or folder is left out.
 * @returns The source to send when the draft is valid, and one message per field that is not.
 */
export function readGitSourceDraft(draft: GitSourceDraft): {
  source?: GitSource;
  errors: Partial<Record<keyof GitSourceDraft, string>>;
} {
  const result = gitSourceSchema.safeParse({
    repo: draft.repo,
    ...(draft.ref.trim() ? { ref: draft.ref } : {}),
    ...(draft.path.trim() ? { path: draft.path } : {}),
  });
  if (result.success) {
    return { source: result.data, errors: {} };
  }
  const errors: Partial<Record<keyof GitSourceDraft, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field === 'repo' || field === 'ref' || field === 'path') {
      errors[field] ??= issue.message;
    }
  }
  return { errors };
}

/**
 * Build the validator for one source field.
 * @param key - The field to validate.
 * @returns A validator giving that field's message, or nothing when what was typed in it is allowed.
 */
function validateSourceField(key: keyof GitSourceDraft) {
  return ({ value }: { value: string }): string | undefined =>
    readGitSourceDraft({ ...EMPTY_GIT_SOURCE, [key]: value }).errors[key];
}

const validateRef = validateSourceField('ref');
const validatePath = validateSourceField('path');
const validateFilledRepo = validateSourceField('repo');

/** An empty repo is not yet wrong: the form's submit stays disabled until there is one. */
function validateRepo({ value }: { value: string }): string | undefined {
  return value === '' ? undefined : validateFilledRepo({ value });
}

/** The form the source fields bind to: one that keeps a {@link GitSourceDraft} under `source`. */
type GitSourceForm = BindableForm & {
  state: { values: { source: GitSourceDraft } };
  setFieldValue: (name: `source.${keyof GitSourceDraft}`, value: string) => void;
};

/**
 * The fields that say where a skill is fetched from: a repo, and optionally a ref and a folder.
 * Pasting a forge's folder URL (`…/tree/<ref>/<folder>`) into the repo field fills all three.
 * @param props.form - The form holding the fields, with the {@link GitSourceDraft} under `source`.
 * @param props.autoFocus - Focus the repo field when the fields mount.
 */
export function GitSourceFields<TForm extends GitSourceForm>({
  form,
  autoFocus = false,
}: {
  form: TForm;
  autoFocus?: boolean;
}) {
  // Narrowed to what the fields read, so their names are checked against the draft alone.
  const sourceForm: GitSourceForm = form;
  return (
    <>
      <InputField
        form={sourceForm}
        name="source.repo"
        validators={{ onChange: validateRepo }}
        label="Repository URL"
        required
        description={
          <>
            An <Code>https://</Code> or SSH clone URL. Paste a folder link from GitHub or GitLab to fill the branch and
            folder too.
          </>
        }
        autoFocus={autoFocus}
        placeholder="https://github.com/owner/repo"
        onPaste={(event) => {
          const parsed = parseGitSourceUrl(event.clipboardData.getData('text'));
          if (parsed.ref) {
            event.preventDefault();
            sourceForm.setFieldValue('source.repo', parsed.repo);
            sourceForm.setFieldValue('source.ref', parsed.ref);
            sourceForm.setFieldValue('source.path', parsed.path ?? '');
          }
        }}
      />
      <FieldRow
        contentSlot={
          <>
            <InputField
              form={sourceForm}
              name="source.ref"
              validators={{ onChange: validateRef }}
              label="Branch or tag"
              description="Blank follows the default branch."
              placeholder="main"
            />
            <InputField
              form={sourceForm}
              name="source.path"
              validators={{ onChange: validatePath }}
              label="Folder"
              description={
                <>
                  Holds the <Code>SKILL.md</Code>. Blank is the repo root.
                </>
              }
              placeholder="skills/my-skill"
            />
          </>
        }
      />
    </>
  );
}
