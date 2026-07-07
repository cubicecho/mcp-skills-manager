import type { SkillSummary } from '@mcp-skills/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BookMarkedIcon, FileTextIcon, FolderIcon, PencilIcon, PlusIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useState } from 'react';
import { ConnectCard } from '@/components/domain/connect-card';
import { NewSkillDialog } from '@/components/domain/skill/new-skill-dialog';
import { UploadSkillDialog } from '@/components/domain/skill/upload-skill-dialog';
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
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { mcpOrigin } from '@/lib/mcp';
import { useDeleteSkill, useServerStatus, useSkills } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

export const Route = createFileRoute('/')({
  component: SkillsPage,
});

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function DeleteSkillButton({ skill }: { skill: SkillSummary }) {
  const remove = useDeleteSkill();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${skill.name}`}>
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete skill "{skill.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the skill file{skill.format === 'dir' ? ' and its directory' : ''}. It will also be
            dropped from any profile that references it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => remove.mutate(skill.name, { onError: toastApiError })}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SkillsPage() {
  const { data, isPending, error } = useSkills();
  const { data: status } = useServerStatus();
  const [newOpen, setNewOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Skills</h1>
          <p className="text-sm text-muted-foreground">
            Markdown documents served to agents over MCP. Each is exposed as both a tool and a resource.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setUploadOpen(true)}>
            <UploadIcon /> Upload
          </Button>
          <Button onClick={() => setNewOpen(true)}>
            <PlusIcon /> New skill
          </Button>
        </div>
      </div>

      {isPending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {error && <p className="text-sm text-destructive">Failed to load skills: {error.message}</p>}

      {data && data.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <BookMarkedIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No skills yet.</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setUploadOpen(true)}>
                <UploadIcon /> Upload
              </Button>
              <Button onClick={() => setNewOpen(true)}>
                <PlusIcon /> New skill
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((skill) => (
                <TableRow key={skill.name}>
                  <TableCell className="font-medium">
                    <Link to="/skills/$name" params={{ name: skill.name }} className="hover:underline">
                      {skill.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">{skill.description || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="gap-1 font-normal">
                      {skill.format === 'dir' ? <FolderIcon className="size-3" /> : <FileTextIcon className="size-3" />}
                      {skill.format}
                      {skill.files.length > 0 && ` · ${skill.files.length} file${skill.files.length === 1 ? '' : 's'}`}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(skill.updatedAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" asChild aria-label={`Edit ${skill.name}`}>
                        <Link to="/skills/$name" params={{ name: skill.name }}>
                          <PencilIcon />
                        </Link>
                      </Button>
                      <DeleteSkillButton skill={skill} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <ConnectCard
            endpoint={`${mcpOrigin(status?.port)}/mcp`}
            label="all skills"
            description="Point an MCP client at this endpoint to get every skill as a tool and a resource. Use a profile endpoint (/mcp/p/<slug>) to serve a filtered subset."
          />
        </>
      )}

      {newOpen && <NewSkillDialog open onOpenChange={setNewOpen} />}
      {uploadOpen && <UploadSkillDialog open onOpenChange={setUploadOpen} />}
    </div>
  );
}
