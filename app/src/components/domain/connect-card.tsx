import { CardLayout } from '@/components/card-layout';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { Plug } from '@/components/ui/icons';
import { useToasts } from '@/lib/toast';

/** Shows an MCP endpoint URL with a copy button and a short explanation. */
export function ConnectCard({
  endpoint,
  label,
  description,
}: {
  endpoint: string;
  label: string;
  description: string;
}) {
  const toast = useToasts();
  return (
    <CardLayout
      icon={<Plug />}
      title={`Connect: ${label}`}
      description={description}
      content={
        <CodeBlock
          content={endpoint}
          wrap
          action={
            <CopyButton
              value={endpoint}
              label="Copy endpoint URL"
              onError={() => toast.error('Failed to copy to clipboard')}
            />
          }
        />
      }
    />
  );
}
