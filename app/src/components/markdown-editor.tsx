import { type ReactNode, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { SplitLayout } from '@/components/split-layout';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';
import { Textarea, type TextareaProps } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * The three views, in the order the toggle draws them, with the name each is shown by.
 *
 * The names are English and are the component's, the way `ThemePicker`'s "Light", "Dark" and
 * "System" are: a toggle whose every call site passes the same three words is three props nobody
 * needed.
 */
const VIEWS = [
  { value: 'edit', label: 'Edit' },
  { value: 'split', label: 'Split' },
  { value: 'preview', label: 'Preview' },
] as const;

export type MarkdownEditorView = (typeof VIEWS)[number]['value'];

const isView = (value: string): value is MarkdownEditorView => VIEWS.some((view) => view.value === value);

/**
 * A pane's floor, shared so the two are the same height when either is short: sixteen rem, enough
 * to read as somewhere to write rather than a one-line field.
 */
const PANE_FLOOR = 'min-h-64';

export type MarkdownEditorProps = Omit<
  TextareaProps,
  'value' | 'defaultValue' | 'onChange' | 'onChangeText' | 'children'
> & {
  /** The Markdown source. The caller holds it: this component keeps no copy. */
  value: string;
  /** Called with the whole source on every edit. */
  onValueChange: (value: string) => void;
  /**
   * Which view is showing: `edit` is the source alone, `preview` the rendered document alone,
   * `split` the two side by side. Pass it with `onViewChange` to hold the view yourself — to keep
   * it in the URL, or in a preference. Left out, the component holds it.
   */
  view?: MarkdownEditorView | undefined;
  /** Called with the view the toggle was moved to. */
  onViewChange?: ((view: MarkdownEditorView) => void) | undefined;
  /** The view to start in when the component holds it. `split` unless given. */
  defaultView?: MarkdownEditorView | undefined;
  /**
   * What the preview draws while the source is blank: "Nothing to preview yet." Left out, the
   * preview is an empty box.
   */
  empty?: ReactNode;
  /** The editor's root: its width, its margin. */
  className?: string | undefined;
};

/**
 * A Markdown source and its rendering: a textarea, a `Markdown` preview, and a toggle between
 * edit, split and preview.
 *
 * It is an editor in the plain sense — a field you type in, with what you typed drawn beside it.
 * Nothing in the preview is editable, and nothing turns into a field when it is clicked: the
 * source is always the textarea, and the textarea is always a textarea.
 *
 * - **The value is the caller's** (`value`, `onValueChange`). Saving, a dirty flag, a debounce
 *   and autosave are the screen's, as they are for every other control.
 * - **The view is the caller's or the component's.** `view` with `onViewChange` holds it outside;
 *   without them it starts at `defaultView` and is held here. It is the one piece of state this
 *   holds, and it is a display preference, not data.
 * - **The rest of the props are the textarea's** — `id`, `placeholder`, `disabled`, `aria-label`,
 *   `aria-invalid`, `name`, `onBlur` — so it is a `FormField`'s `control` like any other.
 *
 * **On a narrow screen `split` is one pane, the source.** Below `lg` there is no room to read two
 * columns, and stacking them puts the preview a screen away from the line being typed; the toggle
 * is still there, and Preview shows the other half. The panes are a `SplitLayout`, so the
 * breakpoint is the one every other split turns at.
 *
 * The textarea stays mounted in all three views — in `preview` it is hidden, not removed — so
 * its undo history, its selection and its scroll position survive a look at the preview.
 *
 * The preview is the plain `Markdown`. An app whose documents need its own links or plugins
 * renders its own `Markdown` beside a `Textarea`; this is the editor for Markdown as written.
 */
export function MarkdownEditor({
  value,
  onValueChange,
  view: heldView,
  onViewChange,
  defaultView = 'split',
  empty,
  className,
  ...textarea
}: MarkdownEditorProps) {
  const [ownView, setOwnView] = useState(defaultView);
  const view = heldView ?? ownView;

  const preview = (
    <div data-slot="markdown-editor-preview" className={cn('rounded-md border border-border bg-card p-4', PANE_FLOOR)}>
      <Markdown content={value} empty={empty} />
    </div>
  );

  return (
    <div data-slot="markdown-editor" className={cn('flex min-w-0 flex-col gap-2', className)}>
      <SegmentedGroup
        aria-label="Editor view"
        value={view}
        onValueChange={(next) => {
          if (!isView(next)) return;
          setOwnView(next);
          onViewChange?.(next);
        }}
        className="self-end"
      >
        {VIEWS.map((one) => (
          <SegmentedButton key={one.value} value={one.value}>
            {one.label}
          </SegmentedButton>
        ))}
      </SegmentedGroup>
      <SplitLayout
        first={
          // One pane holds the textarea in every view, so React keeps the same element — and the
          // browser its undo history — whichever view is showing. In `preview` the pane's other
          // child is the document.
          <>
            <Textarea
              spellCheck={false}
              {...textarea}
              value={value}
              onChangeText={onValueChange}
              className={cn(
                // `block`, because a textarea is inline and an inline box sits on a text line: the
                // pane would be the line's descender taller than the field in it.
                'block font-mono leading-relaxed',
                PANE_FLOOR,
                // Beside the preview it is as tall as the preview, so the two panes end together.
                view === 'split' && 'lg:h-full',
                view === 'preview' && 'hidden',
              )}
            />
            {view === 'preview' ? preview : null}
          </>
        }
        second={view === 'split' ? preview : undefined}
        // Below `lg` the second pane is not stacked under the first but left out: see the
        // component note. `lg:block` is the pane's own display, put back where the panes sit
        // side by side.
        secondClassName="hidden lg:block"
      />
    </div>
  );
}
