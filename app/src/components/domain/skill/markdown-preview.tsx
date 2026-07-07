import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * Renders Markdown as a styled preview. Tailwind class hooks are applied per
 * element (no typography plugin dependency) so the preview reads cleanly in
 * both themes.
 */
export function MarkdownPreview({ content, className }: { content: string; className?: string }) {
  if (!content.trim()) {
    return <p className={cn('text-sm text-muted-foreground italic', className)}>Nothing to preview yet.</p>;
  }
  return (
    <div className={cn('text-sm leading-relaxed', className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => <h1 className="mt-6 mb-3 text-2xl font-semibold first:mt-0" {...props} />,
          h2: ({ node, ...props }) => <h2 className="mt-6 mb-2 text-xl font-semibold first:mt-0" {...props} />,
          h3: ({ node, ...props }) => <h3 className="mt-4 mb-2 text-lg font-semibold first:mt-0" {...props} />,
          p: ({ node, ...props }) => <p className="my-3 first:mt-0" {...props} />,
          ul: ({ node, ...props }) => <ul className="my-3 list-disc pl-6" {...props} />,
          ol: ({ node, ...props }) => <ol className="my-3 list-decimal pl-6" {...props} />,
          li: ({ node, ...props }) => <li className="my-1" {...props} />,
          a: ({ node, ...props }) => <a className="text-primary underline underline-offset-4" {...props} />,
          blockquote: ({ node, ...props }) => (
            <blockquote className="my-3 border-l-2 border-border pl-4 text-muted-foreground" {...props} />
          ),
          code: ({ node, className: codeClass, ...props }) => {
            const isBlock = /language-/.test(codeClass ?? '');
            return isBlock ? (
              <code className={cn('font-mono text-[0.85em]', codeClass)} {...props} />
            ) : (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]" {...props} />
            );
          },
          pre: ({ node, ...props }) => (
            <pre className="my-3 overflow-x-auto rounded-md border bg-muted/50 p-3 text-xs" {...props} />
          ),
          table: ({ node, ...props }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th className="border border-border px-3 py-1.5 text-left font-medium" {...props} />
          ),
          td: ({ node, ...props }) => <td className="border border-border px-3 py-1.5" {...props} />,
          hr: ({ node, ...props }) => <hr className="my-4 border-border" {...props} />,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
