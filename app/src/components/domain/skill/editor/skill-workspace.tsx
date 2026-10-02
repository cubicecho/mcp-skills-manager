import type { SkillDetail } from '@mcp-skills/shared';
import { useEffect, useState } from 'react';
import { isMarkdownPath, SKILL_MD_KEY } from '@/components/domain/skill/editor/file-tree';
import { FilesPanel } from '@/components/domain/skill/editor/files-panel';
import { ReadOnlyFileView } from '@/components/domain/skill/editor/read-only-file-view';
import { SkillBodyEditor } from '@/components/domain/skill/editor/skill-body-editor';
import { SupportingFileEditor } from '@/components/domain/skill/editor/supporting-file-editor';
import type { ViewMode } from '@/components/domain/skill/editor/view-toggle';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Unified skill workspace: a file tree at the top (the skill's own Markdown plus every supporting
 * file and folder) and, below it, an editor for whatever is currently selected. Selecting the skill's
 * Markdown edits its description + body; selecting a `.md` file edits its contents; other files are read-only.
 */
export function SkillWorkspace({ skill }: { skill: SkillDetail }) {
  const [selected, setSelected] = useState<string>(SKILL_MD_KEY);
  // A selection held back until the reader decides what happens to their unsaved edits.
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('split');
  const [dirty, setDirty] = useState(false);

  // If the open file is renamed or deleted out from under us, fall back to the skill's Markdown.
  useEffect(() => {
    if (selected !== SKILL_MD_KEY && !skill.files.some((f) => f.type === 'file' && f.path === selected)) {
      setSelected(SKILL_MD_KEY);
      setDirty(false);
    }
  }, [skill.files, selected]);

  // Warn before leaving with unsaved edits (covers tab close / reload).
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const select = (next: string) => {
    if (next === selected) {
      return;
    }
    if (dirty) {
      setPendingSelection(next);
      return;
    }
    setSelected(next);
  };

  const discardAndSelect = () => {
    if (pendingSelection !== null) {
      setDirty(false);
      setSelected(pendingSelection);
    }
    setPendingSelection(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <ConfirmDialog
        open={pendingSelection !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingSelection(null);
          }
        }}
        title="Discard unsaved changes?"
        description="The edits to the open file have not been saved, and opening another file loses them."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={discardAndSelect}
      />

      <FilesPanel skill={skill} selected={selected} onSelect={select} />

      {selected === SKILL_MD_KEY ? (
        <SkillBodyEditor skill={skill} view={view} setView={setView} onDirtyChange={setDirty} />
      ) : isMarkdownPath(selected) ? (
        <SupportingFileEditor
          key={selected}
          skillName={skill.name}
          path={selected}
          view={view}
          setView={setView}
          onDirtyChange={setDirty}
        />
      ) : (
        <ReadOnlyFileView key={selected} skillName={skill.name} path={selected} />
      )}
    </div>
  );
}
