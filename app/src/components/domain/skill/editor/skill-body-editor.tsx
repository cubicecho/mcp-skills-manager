import { normalizeTags, type SkillDetail } from '@mcp-skills/shared';
import { useStore } from '@tanstack/react-form';
import { useEffect, useMemo } from 'react';
import { InputField, useAppForm } from '@/components/app-form';
import { EditorFrame } from '@/components/domain/skill/editor/editor-frame';
import { SkillFlags } from '@/components/domain/skill/editor/skill-flags';
import { MarkdownEditor } from '@/components/markdown-editor';
import { MultiSelectField } from '@/components/multi-select-field';
import { Code } from '@/components/ui/code';
import { useSkills, useUpdateSkill } from '@/lib/queries';
import { useToasts } from '@/lib/toast';
import { useSaveShortcut } from '@/lib/use-save-shortcut';

/** Edit the skill's own Markdown: its frontmatter description plus its body. */
export function SkillBodyEditor({
  skill,
  onDirtyChange,
  onClose,
}: {
  skill: SkillDetail;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
}) {
  const toast = useToasts();
  const update = useUpdateSkill(skill.name);
  const { data: allSkills } = useSkills();

  const form = useAppForm({
    defaultValues: { description: skill.description, body: skill.body, tags: skill.tags },
    onSubmit: ({ value }) => {
      update.mutate(value, { onSuccess: () => toast.success('Skill saved'), onError: toast.apiError });
    },
  });
  const { description, body, tags } = useStore(form.store, (state) => state.values);

  // Every tag already in use, so an existing one is picked rather than retyped with a new spelling.
  const tagOptions = useMemo(
    () =>
      normalizeTags([...(allSkills ?? []).flatMap((s) => s.tags), ...skill.tags])
        .sort((a, b) => a.localeCompare(b))
        .map((tag) => ({ value: tag, label: tag })),
    [allSkills, skill.tags],
  );
  const tagsDirty = tags.join('\0') !== skill.tags.join('\0');

  // Measured against the skill as last loaded, not the form's defaults: a save refetches the skill, and the
  // editor is clean again once what it holds is what was saved.
  const dirty = description !== skill.description || body !== skill.body || tagsDirty;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = () => void form.handleSubmit();

  useSaveShortcut(save, dirty && !update.isPending);

  const path = skill.format === 'dir' ? `skills/${skill.name}/SKILL.md` : `skills/${skill.path}`;

  return (
    <EditorFrame
      path={path}
      onSave={save}
      onClose={onClose}
      saving={update.isPending}
      dirty={dirty}
      content={
        <>
          <InputField
            form={form}
            name="description"
            label="Description"
            description="Surfaced as the MCP tool and resource description."
            placeholder="One line telling the agent when to use this skill."
          />
          <MultiSelectField
            form={form}
            name="tags"
            label="Tags"
            description={
              <>
                Categories for organising and filtering skills. Written to the frontmatter <Code>tags</Code> key.
              </>
            }
            options={tagOptions}
            onCreateOption={(tag) => form.setFieldValue('tags', normalizeTags([...tags, tag]))}
            createLabel="Add tag"
            placeholder="Add tags…"
            searchPlaceholder="Find or add a tag…"
            searchLabel="Find or add a tag"
            popoverLabel="Tags"
            emptyMessage="No tags yet. Type one to add it."
          />
          <SkillFlags skill={skill} />
          <form.AppField name="body">
            {(field) => (
              <MarkdownEditor
                aria-label="Skill body"
                value={field.state.value}
                onValueChange={field.handleChange}
                onBlur={field.handleBlur}
                placeholder="# My skill…"
                empty="Nothing to preview yet."
              />
            )}
          </form.AppField>
        </>
      }
    />
  );
}
