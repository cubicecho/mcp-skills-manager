import type { SkillDetail } from '@mcp-skills/shared';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { EditorHandle } from '@/components/domain/skill/editor/editor-frame';
import { FilePreview } from '@/components/domain/skill/editor/file-preview';
import { FilesPanel } from '@/components/domain/skill/editor/files-panel';
import { SkillBodyEditor } from '@/components/domain/skill/editor/skill-body-editor';
import { isMarkdownPath, SKILL_MD_KEY } from '@/components/domain/skill/editor/skill-file-key';
import { SupportingFileEditor } from '@/components/domain/skill/editor/supporting-file-editor';
import { StickyHeaderContentFooter } from '@/components/header-content-footer';
import { SidebarLayout } from '@/components/split-layout';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';

/**
 * One skill: its files in a list, and the selected one beside it.
 *
 * @remarks
 * A file opens as a preview, and its Edit button swaps the preview for the editor; only the skill's Markdown
 * and `.md` files have one.
 */
export function SkillWorkspace({
  skill,
  selected,
  startEditing,
  onSelect,
  onEditStarted,
  onRenamed,
}: {
  /** The skill on screen. */
  skill: SkillDetail;
  /** The selected file's path relative to the skill root; absent, the skill's own Markdown. */
  selected: string | undefined;
  /** Opens the selected file in the editor rather than as a preview, once. */
  startEditing: boolean;
  /** Called with the file to open (undefined for the skill's own Markdown), and whether to open it in the editor. */
  onSelect: (path: string | undefined, options?: { edit?: boolean }) => void;
  /** Called once `startEditing` has been acted on, so the caller can drop it. */
  onEditStarted: () => void;
  /** Called with the skill's new name once a rename has been saved. */
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
      sidebarSlot={
        <FilesPanel
          skill={skill}
          selected={path}
          onSelect={(next, options) => onSelect(next === SKILL_MD_KEY ? undefined : next, options)}
          onRenamed={onRenamed}
        />
      }
      contentSlot={
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
  /** The skill the file belongs to. */
  skill: SkillDetail;
  /** The file's path relative to the skill root, or `SKILL_MD_KEY` for the skill's own Markdown. */
  path: string;
  /** Starts in the editor rather than the preview, when the file can be edited here. */
  startEditing: boolean;
  /** Called once `startEditing` has been seen, so the caller can drop it. */
  onEditStarted: () => void;
}) {
  // A skill linked to a git source is read here, never edited: its content is the repo's.
  const editable = !skill.source && (path === SKILL_MD_KEY || isMarkdownPath(path));
  const [editing, setEditing] = useState(startEditing && editable);
  const editor = useRef<EditorHandle>(null);

  useEffect(() => {
    if (startEditing) {
      onEditStarted();
    }
  }, [startEditing, onEditStarted]);

  // Asked when the reader leaves: by Close, by opening another file, skill or page, or by closing the tab.
  const hasUnsavedChanges = () => editor.current?.hasUnsavedChanges() ?? false;
  const blocker = useBlocker({ shouldBlockFn: hasUnsavedChanges, enableBeforeUnload: false, withResolver: true });
  // Only an open editor can hold edits, and the guard listens for the tab closing only while one is open.
  const guard = useUnsavedChangesGuard({
    hasUnsavedChanges: editing && editable ? hasUnsavedChanges : false,
    blocker,
  });

  const close = () => guard.leave(() => setEditing(false));

  return (
    <>
      <UnsavedChangesDialog
        guard={guard}
        discardTitle="Discard unsaved changes?"
        discardDescription="The edits to the open file have not been saved, and leaving the editor loses them."
      />

      {!editing || !editable ? (
        <FilePreview skill={skill} path={path} onEdit={() => setEditing(true)} />
      ) : (
        <StickyHeaderContentFooter
          contentClassName="p-4"
          contentSlot={
            path === SKILL_MD_KEY ? (
              <SkillBodyEditor ref={editor} skill={skill} onClose={close} />
            ) : (
              <SupportingFileEditor ref={editor} skillName={skill.name} path={path} onClose={close} />
            )
          }
        />
      )}
    </>
  );
}
