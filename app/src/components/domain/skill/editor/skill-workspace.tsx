import type { SkillDetail } from '@mcp-skills/shared';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { FilePreview } from '@/components/domain/skill/editor/file-preview';
import { isMarkdownPath, SKILL_MD_KEY } from '@/components/domain/skill/editor/file-tree';
import { FilesPanel } from '@/components/domain/skill/editor/files-panel';
import { SkillBodyEditor } from '@/components/domain/skill/editor/skill-body-editor';
import { SupportingFileEditor } from '@/components/domain/skill/editor/supporting-file-editor';
import { StickyHeaderContentFooter } from '@/components/header-content-footer';
import { SidebarLayout } from '@/components/split-layout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * One skill: its files in a list, and the selected one beside it. A file opens as a preview, and its
 * Edit button swaps the preview for the editor; only the skill's Markdown and `.md` files have one.
 * @param props.skill - The skill on screen.
 * @param props.selected - The selected file's path relative to the skill root; absent, the skill's own Markdown.
 * @param props.startEditing - Open the selected file in the editor rather than as a preview, once.
 * @param props.onSelect - Called with the file to open, and whether to open it in the editor.
 * @param props.onEditStarted - Called once `startEditing` has been acted on, so the caller can drop it.
 * @param props.onRenamed - Called with the skill's new name once a rename has been saved.
 */
export function SkillWorkspace({
  skill,
  selected,
  startEditing,
  onSelect,
  onEditStarted,
  onRenamed,
}: {
  skill: SkillDetail;
  selected: string | undefined;
  startEditing: boolean;
  onSelect: (path: string | undefined, options?: { edit?: boolean }) => void;
  onEditStarted: () => void;
  onRenamed: (name: string) => void;
}) {
  const exists = selected !== undefined && skill.files.some((f) => f.type === 'file' && f.path === selected);
  const path = exists ? selected : SKILL_MD_KEY;

  // If the open file is renamed or deleted out from under us, fall back to the skill's Markdown.
  useEffect(() => {
    if (selected !== undefined && !exists) {
      onSelect(undefined);
    }
  }, [selected, exists, onSelect]);

  return (
    <SidebarLayout
      className="md:h-full"
      sidebarPosition="start"
      sidebarWidth="md"
      stackBelow="md"
      divider="line"
      sidebar={
        <FilesPanel
          skill={skill}
          selected={path}
          onSelect={(next, options) => onSelect(next === SKILL_MD_KEY ? undefined : next, options)}
          onRenamed={onRenamed}
        />
      }
      content={
        <FilePane key={path} skill={skill} path={path} startEditing={startEditing} onEditStarted={onEditStarted} />
      }
    />
  );
}

/** The selected file: its preview, or its editor, which asks before unsaved edits are left behind. */
function FilePane({
  skill,
  path,
  startEditing,
  onEditStarted,
}: {
  skill: SkillDetail;
  path: string;
  startEditing: boolean;
  onEditStarted: () => void;
}) {
  // A skill linked to a git source is read here, never edited: its content is the repo's.
  const editable = !skill.source && (path === SKILL_MD_KEY || isMarkdownPath(path));
  const [editing, setEditing] = useState(startEditing && editable);
  const [dirty, setDirty] = useState(false);
  // Close was pressed over unsaved edits, and the reader has not yet said what happens to them.
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (startEditing) {
      onEditStarted();
    }
  }, [startEditing, onEditStarted]);

  // Opening another file, another skill or another page, and closing or reloading the tab.
  const unsaved = editing && editable && dirty;
  const blocker = useBlocker({ shouldBlockFn: () => unsaved, enableBeforeUnload: () => unsaved, withResolver: true });

  const stopEditing = () => {
    setDirty(false);
    setEditing(false);
  };

  const keepEditing = () => {
    setClosing(false);
    blocker.reset?.();
  };

  const discard = () => {
    setClosing(false);
    if (blocker.status === 'blocked') {
      blocker.proceed();
    } else {
      stopEditing();
    }
  };

  const close = () => (dirty ? setClosing(true) : stopEditing());

  return (
    <>
      <ConfirmDialog
        open={closing || blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) {
            keepEditing();
          }
        }}
        title="Discard unsaved changes?"
        description="The edits to the open file have not been saved, and leaving the editor loses them."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={discard}
      />

      {!editing || !editable ? (
        <FilePreview skill={skill} path={path} onEdit={() => setEditing(true)} />
      ) : (
        <StickyHeaderContentFooter
          contentClassName="p-4"
          content={
            path === SKILL_MD_KEY ? (
              <SkillBodyEditor skill={skill} onDirtyChange={setDirty} onClose={close} />
            ) : (
              <SupportingFileEditor skillName={skill.name} path={path} onDirtyChange={setDirty} onClose={close} />
            )
          }
        />
      )}
    </>
  );
}
