import type { ProfileStatus } from '@mcp-skills/shared';
import { createFileRoute } from '@tanstack/react-router';
import { CheckIcon, CopyIcon, LayersIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ProfileDialog } from '@/components/domain/profile/profile-dialog';
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
import { useDeleteProfile, useProfiles } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

export const Route = createFileRoute('/profiles')({
  component: ProfilesPage,
});

/** create → the New button; edit → a specific profile; null → closed. */
type DialogState = { mode: 'create' } | { mode: 'edit'; profile: ProfileStatus } | null;

function CopyUrlButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
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

function DeleteProfileButton({ profile }: { profile: ProfileStatus }) {
  const remove = useDeleteProfile();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${profile.name}`}>
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete profile "{profile.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the profile and its endpoint. The skills themselves are not deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => remove.mutate(profile.slug, { onError: toastApiError })}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProfilesPage() {
  const { data, isPending, error } = useProfiles();
  const [dialog, setDialog] = useState<DialogState>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Profiles</h1>
          <p className="text-sm text-muted-foreground">
            Group a chosen subset of skills into a filtered endpoint at <code>/mcp/p/&lt;slug&gt;</code> (or serve it
            over stdio with <code>--profile &lt;slug&gt;</code>).
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: 'create' })}>
          <PlusIcon /> New profile
        </Button>
      </div>

      {isPending && <Skeleton className="h-32 w-full" />}
      {error && <p className="text-sm text-destructive">Failed to load profiles: {error.message}</p>}

      {data && data.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayersIcon className="size-5" /> No profiles yet
            </CardTitle>
            <CardDescription>Create a profile to serve a tailored set of skills to a specific agent.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setDialog({ mode: 'create' })}>
              <PlusIcon /> New profile
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
            {data.map((profile) => (
              <TableRow key={profile.slug}>
                <TableCell className="font-medium">
                  {profile.name}
                  {profile.description && (
                    <span className="block text-xs font-normal text-muted-foreground">{profile.description}</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                    {profile.path}
                    <CopyUrlButton path={profile.path} />
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {profile.resolvedCount}
                  {profile.resolvedCount !== profile.skills.length && (
                    <span className="text-xs"> / {profile.skills.length}</span>
                  )}{' '}
                  {profile.skills.length === 1 ? 'skill' : 'skills'}
                </TableCell>
                <TableCell>
                  {profile.enabled ? (
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
                      aria-label={`Edit ${profile.name}`}
                      onClick={() => setDialog({ mode: 'edit', profile })}
                    >
                      <PencilIcon />
                    </Button>
                    <DeleteProfileButton profile={profile} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {dialog?.mode === 'create' && <ProfileDialog open onOpenChange={() => setDialog(null)} />}
      {dialog?.mode === 'edit' && <ProfileDialog open profile={dialog.profile} onOpenChange={() => setDialog(null)} />}
    </div>
  );
}
