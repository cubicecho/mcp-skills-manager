import { Split } from '@/components/app-icons';
import { Eye, Pencil } from '@/components/ui/icons';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';

/** How the Markdown editor shows a document: source only, source beside its preview, or preview only. */
export type ViewMode = 'edit' | 'split' | 'preview';

const VIEW_OPTIONS = [
  { value: 'edit', label: 'Edit', icon: Pencil },
  { value: 'split', label: 'Split', icon: Split },
  { value: 'preview', label: 'Preview', icon: Eye },
] as const;

/**
 * The Edit / Split / Preview switch of a Markdown editor.
 * @param props.view - The current view mode.
 * @param props.onChange - Called with the mode the reader picked.
 */
export function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (view: ViewMode) => void }) {
  return (
    <SegmentedGroup aria-label="Editor view" value={view} onValueChange={(next) => onChange(next as ViewMode)}>
      {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
        // The label is on screen from `sm` up; below it the icon stands alone and `aria-label` names it.
        <SegmentedButton
          key={value}
          value={value}
          aria-label={label}
          title={label}
          className="flex-row items-center gap-1.5"
        >
          <Icon className="size-3.5" />
          <span className="hidden font-medium text-sm sm:inline">{label}</span>
        </SegmentedButton>
      ))}
    </SegmentedGroup>
  );
}
