import type { ReactNode } from 'react';
import { Save } from '@/components/app-icons';
import { type ViewMode, ViewToggle } from '@/components/domain/skill/editor/view-toggle';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';

/** A file path as a `Section` title: the path as written, not the uppercase overline. */
export const FILE_TITLE = 'font-mono text-sm normal-case tracking-normal text-foreground';

/** The card an editor sits on: the file path as its heading, the view toggle + Save at the far end. */
export function EditorFrame({
  path,
  view,
  setView,
  onSave,
  saving,
  dirty,
  content,
}: {
  path: string;
  view: ViewMode;
  setView: (view: ViewMode) => void;
  onSave: () => void;
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
