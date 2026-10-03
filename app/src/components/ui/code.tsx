import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Code({ className, children }: { className?: string | undefined; children: ReactNode }) {
  return (
    <span className={cn('cube-rn-text', 'rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground', className)}>
      {children}
    </span>
  );
}
