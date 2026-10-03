import type { ViewMode } from '@/components/domain/skill/editor/view-toggle';
import { MarkdownPreview } from '@/components/domain/skill/markdown-preview';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** The Markdown editor grid used for both the skill body and supporting `.md` files. */
export function MarkdownEditor({
  value,
  onChange,
  view,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  view: ViewMode;
  placeholder?: string;
}) {
  return (
    <div className={cn('grid min-h-[50vh] gap-4', view === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1')}>
      {view !== 'preview' && (
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="min-h-[50vh] flex-1 resize-none font-mono text-sm leading-relaxed"
          placeholder={placeholder}
        />
      )}
      {view !== 'edit' && (
        <div className="min-h-[50vh] flex-1 overflow-auto rounded-md border bg-card p-4">
          <MarkdownPreview content={value} />
        </div>
      )}
    </div>
  );
}
