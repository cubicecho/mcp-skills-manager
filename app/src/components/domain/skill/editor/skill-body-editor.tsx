import { normalizeTags, type SkillDetail } from '@mcp-skills/shared';
import { useEffect, useMemo, useState } from 'react';
import { EditorFrame } from '@/components/domain/skill/editor/editor-frame';
import { SkillFlags } from '@/components/domain/skill/editor/skill-flags';
import { FormField } from '@/components/form-field';
import { MarkdownEditor } from '@/components/markdown-editor';
import { MultiSelect } from '@/components/multi-select';
import { Code } from '@/components/ui/code';
import { Input } from '@/components/ui/input';
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
  const [description, setDescription] = useState(skill.description);
  const [body, setBody] = useState(skill.body);
  const [tags, setTags] = useState<string[]>(skill.tags);
  const { data: allSkills } = useSkills();

  // Every tag already in use, so an existing one is picked rather than retyped with a new spelling.
  const tagOptions = useMemo(
    () =>
      normalizeTags([...(allSkills ?? []).flatMap((s) => s.tags), ...skill.tags])
        .sort((a, b) => a.localeCompare(b))
        .map((tag) => ({ value: tag, label: tag })),
    [allSkills, skill.tags],
  );
  const tagsDirty = tags.join('\0') !== skill.tags.join('\0');

  const dirty = description !== skill.description || body !== skill.body || tagsDirty;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = () => {
    update.mutate(
      { description, body, tags },
      { onSuccess: () => toast.success('Skill saved'), onError: toast.apiError },
    );
  };

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
          <FormField
            label="Description"
            description="Surfaced as the MCP tool and resource description."
            control={
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="One line telling the agent when to use this skill."
              />
            }
          />
          <FormField
            label="Tags"
            description={
              <>
                Categories for organising and filtering skills. Written to the frontmatter <Code>tags</Code> key.
              </>
            }
            control={(wired) => (
              <MultiSelect
                {...wired}
                options={tagOptions}
                value={tags}
                onValueChange={setTags}
                onCreateOption={(tag) => setTags(normalizeTags([...tags, tag]))}
                createLabel="Add tag"
                placeholder="Add tags…"
                searchPlaceholder="Find or add a tag…"
                searchLabel="Find or add a tag"
                popoverLabel="Tags"
                emptyMessage="No tags yet. Type one to add it."
              />
            )}
          />
          <SkillFlags skill={skill} />
          <MarkdownEditor
            aria-label="Skill body"
            value={body}
            onValueChange={setBody}
            placeholder="# My skill…"
            empty="Nothing to preview yet."
          />
        </>
      }
    />
  );
}
