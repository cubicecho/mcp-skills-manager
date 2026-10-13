import type { ReactNode } from 'react';
import { useState } from 'react';
import { isMarkdownPath } from '@/components/domain/skill/editor/skill-file-key';
import type { PathPrompt } from '@/components/domain/skill/path-prompt-dialog';
import { Code } from '@/components/ui/code';
import { useCreateSkillFolder, useMoveSkillPath, useWriteSkillFile } from '@/lib/queries';
import { reported } from '@/lib/reported';
import { useToasts } from '@/lib/toast';
import type { TreeEntry } from '@/lib/tree';

/**
 * Describes where a new file or folder will be created.
 *
 * @param base - The folder it is created under, relative to the skill root; empty for the root itself.
 * @returns The description shown in the path prompt.
 */
function pathHint(base: string): ReactNode {
  if (!base) {
    return 'A path relative to the skill root.';
  }
  return (
    <>
      Created under <Code>{base}/</Code>.
    </>
  );
}

/**
 * Holds the path questions a skill's file list asks — new file, new folder, rename — and what each does
 * with its answer.
 *
 * @param skillName - The skill whose files are changed.
 * @param onSelect - Called with a file just created, to open it; `edit` asks for it in the editor.
 * @param onMove - Called with the old and new paths of a rename as it is asked for, before it has happened.
 * @returns The question now open (`null` for none), `close` to dismiss it, and one opener per question.
 */
export function useFilePrompts(
  skillName: string,
  onSelect: (path: string, options?: { edit?: boolean }) => void,
  onMove: (from: string, to: string) => void,
) {
  const toast = useToasts();
  const writeFile = useWriteSkillFile(skillName);
  const createFolder = useCreateSkillFolder(skillName);
  const movePath = useMoveSkillPath(skillName);
  const [prompt, setPrompt] = useState<PathPrompt | null>(null);

  const newFile = (base = '') =>
    setPrompt({
      title: 'New file',
      description: pathHint(base),
      label: 'Path',
      placeholder: base ? 'intro.md' : 'docs/intro.md',
      submitLabel: 'Create file',
      onSubmit: async (rel) => {
        const path = base ? `${base}/${rel}` : rel;
        await reported(writeFile.mutateAsync({ path, content: '', encoding: 'utf8' }), toast.apiError);
        onSelect(path, { edit: isMarkdownPath(path) });
      },
    });

  const newFolder = (base = '') =>
    setPrompt({
      title: 'New folder',
      description: pathHint(base),
      label: base ? 'Name' : 'Path',
      placeholder: base ? 'examples' : 'reference/examples',
      submitLabel: 'Create folder',
      onSubmit: (rel) => reported(createFolder.mutateAsync({ path: base ? `${base}/${rel}` : rel }), toast.apiError),
    });

  const rename = (entry: TreeEntry) =>
    setPrompt({
      title: `Rename ${entry.type === 'dir' ? 'folder' : 'file'}`,
      description: 'A path relative to the skill root; changing the folders moves it.',
      label: 'Path',
      initial: entry.path,
      submitLabel: 'Rename',
      onSubmit: async (next) => {
        onMove(entry.path, next);
        await reported(movePath.mutateAsync({ from: entry.path, to: next }), toast.apiError);
        toast.success(`Renamed to ${next}`);
      },
    });

  return { prompt, close: () => setPrompt(null), newFile, newFolder, rename };
}
