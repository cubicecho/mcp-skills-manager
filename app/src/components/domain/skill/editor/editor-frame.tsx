import type { ReactNode } from 'react';
import { Save } from '@/components/app-icons';
import { type ViewMode, ViewToggle } from '@/components/domain/skill/editor/view-toggle';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { X } from '@/components/ui/icons';

/** A file path as a `Section` title: the path as written, not the uppercase overline. */
export const FILE_TITLE = 'font-mono text-sm normal-case tracking-normal text-foreground';

/** The card an editor sits on: the file path as its heading, the view toggle, Close and Save at the far end. */
export function EditorFrame({
  path,
  view,
  setView,
  onSave,
  onClose,
  saving,
  dirty,
  content,
}: {
  path: string;
  view: ViewMode;
  setView: (view: ViewMode) => void;
  onSave: () => void;
  /** Called when the reader leaves the editor for the preview; the caller asks about unsaved edits. */
  onClose: () => void;
  saving: boolean;
  dirty: boolean;
  content: ReactNode;
}) {
  return (
    <Section
      surface="card"
      title={path}
      titleClassName={FILE_TITLE}
      action={
        <div className="flex items-center gap-2">
          <ViewToggle view={view} onChange={setView} />
          <Button variant="outline" onClick={onClose}>
            <X /> Close
          </Button>
          <Button onClick={onSave} disabled={!dirty || saving}>
            <Save /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
      contentClassName="gap-3"
      content={content}
    />
  );
}
