import { Plug } from '@/components/app-icons';
import { CardLayout } from '@/components/card-layout';
import { CopyButton } from '@/components/ui/copy-button';
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
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-sm">{endpoint}</code>
          <CopyButton
            value={endpoint}
            label="Copy endpoint URL"
            onError={() => toast.error('Failed to copy to clipboard')}
          />
        </div>
      }
    />
  );
}
