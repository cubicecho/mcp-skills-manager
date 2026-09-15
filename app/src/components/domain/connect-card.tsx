import { CheckIcon, CopyIcon, PlugIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import { CardLayout } from '@/components/card-layout';

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
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  return (
    <CardLayout
      icon={<PlugIcon />}
      title={`Connect: ${label}`}
      description={description}
      content={
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-sm">{endpoint}</code>
          <ActionButton variant="ghost" size="icon-sm" label="Copy endpoint URL" onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </ActionButton>
        </div>
      }
    />
  );
}
