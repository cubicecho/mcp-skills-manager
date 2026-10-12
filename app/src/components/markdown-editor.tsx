import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { SplitLayout } from "@/components/split-layout";
import { SegmentedButton, SegmentedGroup } from "@/components/ui/segmented";
import { Textarea, type TextareaProps } from "@/components/ui/textarea";
import { cn, type SlotNode } from "@/lib/utils";

/**
 * The three views, in the order the toggle draws them, with the name each is shown by.
 *
 * The names are English and are the component's, the way `ThemePicker`'s "Light", "Dark" and
 * "System" are: a toggle whose every call site passes the same three words is three props nobody
 * needed.
 */
const VIEWS = [
  { value: "edit", label: "Edit" },
  { value: "split", label: "Split" },
  { value: "preview", label: "Preview" },
] as const;

/** Which panes the editor shows: the source, the preview, or both. */
export type MarkdownEditorView = (typeof VIEWS)[number]["value"];

const isView = (value: string): value is MarkdownEditorView =>
  VIEWS.some((view) => view.value === value);

/**
 * A pane's floor, shared so the two are the same height when either is short: sixteen rem, enough
 * to read as somewhere to write rather than a one-line field.
 */
const PANE_FLOOR = "min-h-64";

export type MarkdownEditorProps = Omit<
  TextareaProps,
  "value" | "defaultValue" | "onChange" | "onChangeText" | "children"
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
  emptySlot?: SlotNode;
  /** The editor's root: its width, its margin. */
  className?: string | undefined;
};

/**
 * A Markdown source and its rendering: a textarea, a `Markdown` preview, and a toggle between
 * edit, split and preview. Nothing in the preview is editable; the source is always the textarea.
 *
 * The value is the caller's (`value`, `onValueChange`), and the rest of the props are the
 * textarea's, so it is a `FormField`'s `controlSlot` like any other. The view is held here from
 * `defaultView`, or outside with `view` and `onViewChange`. Below `lg`, `split` shows the source
 * alone. The textarea stays mounted in all three views, so its undo history and selection survive
 * a look at the preview.
 */
export function MarkdownEditor({
  value,
  onValueChange,
  view: heldView,
  onViewChange,
  defaultView = "split",
  emptySlot,
  className,
  ...textarea
}: MarkdownEditorProps) {
  const [ownView, setOwnView] = useState(defaultView);
  const view = heldView ?? ownView;

  const preview = (
    <div
      data-slot="markdown-editor-preview"
      className={cn("rounded-md border border-foreground/10 bg-secondary p-4", PANE_FLOOR)}
    >
      <Markdown content={value} emptySlot={emptySlot} />
    </div>
  );

  return (
    <div data-slot="markdown-editor" className={cn("flex min-w-0 flex-col gap-2", className)}>
      <SegmentedGroup
        aria-label="Editor view"
        value={view}
        onValueChange={(next) => {
          if (isView(next) === false) {
            return;
          }
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
        firstSlot={
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
                "block font-mono leading-relaxed",
                PANE_FLOOR,
                // Beside the preview it is as tall as the preview, so the two panes end together.
                view === "split" && "lg:h-full",
                view === "preview" && "hidden",
              )}
            />
            {view === "preview" ? preview : null}
          </>
        }
        secondSlot={view === "split" ? preview : undefined}
        // Below `lg` the second pane is not stacked under the first but left out: see the
        // component note. `lg:block` is the pane's own display, put back where the panes sit
        // side by side.
        secondClassName="hidden lg:block"
      />
    </div>
  );
}
