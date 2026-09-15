import type { WorkspaceStatus } from '@mcp-skills/shared';
import { createFileRoute } from '@tanstack/react-router';
import { CheckIcon, CopyIcon, LayersIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { WorkspaceDialog } from '@/components/domain/workspace/workspace-dialog';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
    <ActionButton variant="ghost" size="icon-sm" label={`Copy URL for ${path}`} onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </ActionButton>
  );
}

function DeleteWorkspaceButton({ workspace }: { workspace: WorkspaceStatus }) {
  const remove = useDeleteWorkspace();
  return (
    <ConfirmButton
      variant="ghost"
      size="icon-sm"
      label={`Delete ${workspace.name}`}
      title={`Delete workspace "${workspace.name}"?`}
      description="This removes the workspace and its endpoint. The skills themselves are not deleted."
      onConfirm={() => remove.mutate(workspace.slug, { onError: toastApiError })}
    >
      <Trash2Icon />
    </ConfirmButton>
  );
}

function WorkspacesPage() {
  const workspaces = useWorkspaces();
  const { data } = workspaces;
  const { data: status } = useServerStatus();
  const [dialog, setDialog] = useState<DialogState>(null);
  const origin = mcpOrigin(status?.port);

  const newWorkspaceButton = (
    <Button onClick={() => setDialog({ mode: 'create' })}>
      <PlusIcon /> New workspace
    </Button>
  );

  return (
    <>
      <PageLayout
        title="Workspaces"
        description={
          <>
            Group a chosen subset of skills into a filtered endpoint at <code>/mcp/w/&lt;slug&gt;</code> (or serve it
            over stdio with <code>--workspace &lt;slug&gt;</code>).
          </>
        }
        action={newWorkspaceButton}
        content={
          <div className="flex flex-col gap-6 py-6">
            <QueryState
              query={workspaces}
              what="workspaces"
              count={data?.length ?? 0}
              empty={
                <CardLayout
                  icon={<LayersIcon />}
                  title="No workspaces yet"
                  description="Create a workspace to serve a tailored set of skills to a specific agent."
                  content={newWorkspaceButton}
                />
              }
            />

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
                          <span className="block text-xs font-normal text-muted-foreground">
                            {workspace.description}
                          </span>
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
                          <ActionButton
                            variant="ghost"
                            size="icon-sm"
                            label={`Edit ${workspace.name}`}
                            onClick={() => setDialog({ mode: 'edit', workspace })}
                          >
                            <PencilIcon />
                          </ActionButton>
                          <DeleteWorkspaceButton workspace={workspace} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        }
      />
      {dialog?.mode === 'create' && <WorkspaceDialog open onOpenChange={() => setDialog(null)} />}
      {dialog?.mode === 'edit' && (
        <WorkspaceDialog open workspace={dialog.workspace} onOpenChange={() => setDialog(null)} />
      )}
    </>
  );
}
