import { type GitSource, gitSourceSchema, parseGitSourceUrl } from '@mcp-skills/shared';
import { FieldRow } from '@/components/field-row';
import { FormField } from '@/components/form-field';
import { Code } from '@/components/ui/code';
import { Input } from '@/components/ui/input';

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
 * The fields that say where a skill is fetched from: a repo, and optionally a ref and a folder.
 * Pasting a forge's folder URL (`…/tree/<ref>/<folder>`) into the repo field fills all three.
 * @param props.value - The fields as typed.
 * @param props.onValueChange - Called with the fields after each edit.
 * @param props.autoFocus - Focus the repo field when the fields mount.
 */
export function GitSourceFields({
  value,
  onValueChange,
  autoFocus,
}: {
  value: GitSourceDraft;
  onValueChange: (value: GitSourceDraft) => void;
  autoFocus?: boolean;
}) {
  const { errors } = readGitSourceDraft(value);
  return (
    <>
      <FormField
        label="Repository URL"
        required
        description={
          <>
            An <Code>https://</Code> or SSH clone URL. Paste a folder link from GitHub or GitLab to fill the branch and
            folder too.
          </>
        }
        // An untouched field is not yet wrong.
        error={value.repo ? errors.repo : undefined}
        control={
          <Input
            value={value.repo}
            autoFocus={autoFocus}
            placeholder="https://github.com/owner/repo"
            onChange={(event) => onValueChange({ ...value, repo: event.target.value })}
            onPaste={(event) => {
              const parsed = parseGitSourceUrl(event.clipboardData.getData('text'));
              if (parsed.ref) {
                event.preventDefault();
                onValueChange({ repo: parsed.repo, ref: parsed.ref, path: parsed.path ?? '' });
              }
            }}
          />
        }
      />
      <FieldRow
        content={
          <>
            <FormField
              label="Branch or tag"
              description="Blank follows the default branch."
              error={errors.ref}
              control={
                <Input
                  value={value.ref}
                  placeholder="main"
                  onChange={(event) => onValueChange({ ...value, ref: event.target.value })}
                />
              }
            />
            <FormField
              label="Folder"
              description={
                <>
                  Holds the <Code>SKILL.md</Code>. Blank is the repo root.
                </>
              }
              error={errors.path}
              control={
                <Input
                  value={value.path}
                  placeholder="skills/my-skill"
                  onChange={(event) => onValueChange({ ...value, path: event.target.value })}
                />
              }
            />
          </>
        }
      />
    </>
  );
}
