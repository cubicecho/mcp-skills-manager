import type { WorkspaceStatus } from '@mcp-skills/shared';
import { createFileRoute } from '@tanstack/react-router';
import { CheckIcon, CopyIcon, LayersIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { WorkspaceDialog } from '@/components/domain/workspace/workspace-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { mcpOrigin } from '@/lib/mcp';
import { useDeleteWorkspace, useServerStatus, useWorkspaces } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

export const Route = createFileRoute('/workspaces')({
  component: WorkspacesPage,
});

/** create → the New button; edit → a specific workspace; null → closed. */
type DialogState = { mode: 'create' } | { mode: 'edit'; workspace: WorkspaceStatus } | null;

function CopyUrlButton({ path, origin }: { path: string; origin: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${origin}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };
  return (
    <Button variant="ghost" size="icon-sm" aria-label={`Copy URL for ${path}`} onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

function DeleteWorkspaceButton({ workspace }: { workspace: WorkspaceStatus }) {
  const remove = useDeleteWorkspace();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${workspace.name}`}>
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete workspace "{workspace.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the workspace and its endpoint. The skills themselves are not deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => remove.mutate(workspace.slug, { onError: toastApiError })}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function WorkspacesPage() {
  const { data, isPending, error } = useWorkspaces();
  const { data: status } = useServerStatus();
  const [dialog, setDialog] = useState<DialogState>(null);
  const origin = mcpOrigin(status?.port);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Workspaces</h1>
          <p className="text-sm text-muted-foreground">
            Group a chosen subset of skills into a filtered endpoint at <code>/mcp/w/&lt;slug&gt;</code> (or serve it
            over stdio with <code>--workspace &lt;slug&gt;</code>).
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: 'create' })}>
          <PlusIcon /> New workspace
        </Button>
      </div>

      {isPending && <Skeleton className="h-32 w-full" />}
      {error && <p className="text-sm text-destructive">Failed to load workspaces: {error.message}</p>}

      {data && data.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayersIcon className="size-5" /> No workspaces yet
            </CardTitle>
            <CardDescription>Create a workspace to serve a tailored set of skills to a specific agent.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setDialog({ mode: 'create' })}>
              <PlusIcon /> New workspace
            </Button>
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Skills</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((workspace) => (
              <TableRow key={workspace.slug}>
                <TableCell className="font-medium">
                  {workspace.name}
                  {workspace.description && (
                    <span className="block text-xs font-normal text-muted-foreground">{workspace.description}</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                    {workspace.path}
                    <CopyUrlButton path={workspace.path} origin={origin} />
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {workspace.resolvedCount}
                  {workspace.resolvedCount !== workspace.skills.length && (
                    <span className="text-xs"> / {workspace.skills.length}</span>
                  )}{' '}
                  {workspace.skills.length === 1 ? 'skill' : 'skills'}
                </TableCell>
                <TableCell>
                  {workspace.enabled ? (
                    <Badge variant="outline">Enabled</Badge>
                  ) : (
                    <Badge variant="secondary">Disabled</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${workspace.name}`}
                      onClick={() => setDialog({ mode: 'edit', workspace })}
                    >
                      <PencilIcon />
                    </Button>
                    <DeleteWorkspaceButton workspace={workspace} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {dialog?.mode === 'create' && <WorkspaceDialog open onOpenChange={() => setDialog(null)} />}
      {dialog?.mode === 'edit' && (
        <WorkspaceDialog open workspace={dialog.workspace} onOpenChange={() => setDialog(null)} />
      )}
    </div>
  );
}
