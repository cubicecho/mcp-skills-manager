import { type GitSource, gitSourceSchema, parseGitSourceUrl } from '@mcp-skills/shared';
import { withFieldGroup } from '@/components/app-form';
import { FieldRow } from '@/components/field-row';
import { Code } from '@/components/ui/code';

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

/**
 * The fields that say where a skill is fetched from: a repo, and optionally a ref and a folder.
 * Pasting a forge's folder URL (`…/tree/<ref>/<folder>`) into the repo field fills all three.
 * @param props.form - The form holding the fields.
 * @param props.fields - Where in the form's values the {@link GitSourceDraft} sits.
 * @param props.autoFocus - Focus the repo field when the fields mount.
 */
export const GitSourceFields = withFieldGroup({
  defaultValues: EMPTY_GIT_SOURCE,
  props: { autoFocus: false },
  render: function GitSourceFieldGroup({ group, autoFocus }) {
    return (
      <>
        <group.AppField name="repo" validators={{ onChange: validateRepo }}>
          {(field) => (
            <field.InputField
              label="Repository URL"
              required
              description={
                <>
                  An <Code>https://</Code> or SSH clone URL. Paste a folder link from GitHub or GitLab to fill the
                  branch and folder too.
                </>
              }
              autoFocus={autoFocus}
              placeholder="https://github.com/owner/repo"
              onPaste={(event) => {
                const parsed = parseGitSourceUrl(event.clipboardData.getData('text'));
                if (parsed.ref) {
                  event.preventDefault();
                  group.setFieldValue('repo', parsed.repo);
                  group.setFieldValue('ref', parsed.ref);
                  group.setFieldValue('path', parsed.path ?? '');
                }
              }}
            />
          )}
        </group.AppField>
        <FieldRow
          content={
            <>
              <group.AppField name="ref" validators={{ onChange: validateRef }}>
                {(field) => (
                  <field.InputField
                    label="Branch or tag"
                    description="Blank follows the default branch."
                    placeholder="main"
                  />
                )}
              </group.AppField>
              <group.AppField name="path" validators={{ onChange: validatePath }}>
                {(field) => (
                  <field.InputField
                    label="Folder"
                    description={
                      <>
                        Holds the <Code>SKILL.md</Code>. Blank is the repo root.
                      </>
                    }
                    placeholder="skills/my-skill"
                  />
                )}
              </group.AppField>
            </>
          }
        />
      </>
    );
  },
});
