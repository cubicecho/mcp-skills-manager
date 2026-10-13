import { Save } from '@/components/app-icons';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { X } from '@/components/ui/icons';
import type { SlotNode } from '@/lib/utils';

/** What an editor answers to the pane that holds it, asked at the moment the reader leaves. */
export type EditorHandle = {
  /** Whether the editor holds edits that have not been saved. */
  hasUnsavedChanges: () => boolean;
};

/** A file path as a `Section` title: the path as written, not the uppercase overline. */
export const FILE_TITLE = 'font-mono text-sm normal-case tracking-normal text-foreground';

/** The card an editor sits on: the file path as its heading, Close and Save at the far end. */
export function EditorFrame({
  path,
  onSave,
  onClose,
  saving,
  dirty,
  contentSlot,
}: {
  /** The file's path, shown as the heading. */
  path: string;
  /** Called when Save is pressed. */
  onSave: () => void;
  /** Called when the reader leaves the editor for the preview; the caller asks about unsaved edits. */
  onClose: () => void;
  /** A save is in flight: Save is disabled and reads "Saving…". */
  saving: boolean;
  /** The editor holds unsaved edits; Save is disabled without them. */
  dirty: boolean;
  /** The editor's fields. */
  contentSlot: SlotNode;
}) {
  return (
    <Section
      surface="card"
      title={path}
      titleClassName={FILE_TITLE}
      actionSlot={
        <>
          <Button variant="outline" onClick={onClose} content="Close" iconSlot={<X />} />
          <Button
            onClick={onSave}
            disabled={!dirty || saving}
            content={saving ? 'Saving…' : 'Save'}
            iconSlot={<Save />}
          />
        </>
      }
      contentClassName="gap-3"
      contentSlot={contentSlot}
    />
  );
}
