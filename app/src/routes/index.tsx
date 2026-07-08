import type { SkillSummary } from '@mcp-skills/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  BookMarkedIcon,
  FileTextIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

type ScopeFilter = 'all' | 'global' | 'scoped';
type FormatFilter = 'all' | 'dir' | 'file';
type SortKey = 'name' | 'updated';

/** Apply the search query, scope/format/tag filters and sort to the raw skill list. */
function filterAndSort(
  skills: SkillSummary[],
  query: string,
  scope: ScopeFilter,
  format: FormatFilter,
  tag: string,
  sort: SortKey,
): SkillSummary[] {
  const q = query.trim().toLowerCase();
  const matched = skills.filter((skill) => {
    if (scope === 'global' && !skill.global) return false;
    if (scope === 'scoped' && skill.global) return false;
    if (format !== 'all' && skill.format !== format) return false;
    if (tag !== 'all' && !skill.tags.includes(tag)) return false;
    if (q && !`${skill.name} ${skill.description} ${skill.tags.join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return matched.sort((a, b) =>
    sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : a.name.localeCompare(b.name),
  );
}

/** All distinct tags across the skill list, sorted for a stable filter dropdown. */
function collectTags(skills: SkillSummary[]): string[] {
  return [...new Set(skills.flatMap((skill) => skill.tags))].sort((a, b) => a.localeCompare(b));
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
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [format, setFormat] = useState<FormatFilter>('all');
  const [tag, setTag] = useState('all');
  const [sort, setSort] = useState<SortKey>('name');

  const allTags = useMemo(() => (data ? collectTags(data) : []), [data]);
  // A previously selected tag can disappear when skills change — fall back to "all".
  const activeTag = tag !== 'all' && !allTags.includes(tag) ? 'all' : tag;
  const visible = useMemo(
    () => (data ? filterAndSort(data, query, scope, format, activeTag, sort) : []),
    [data, query, scope, format, activeTag, sort],
  );

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
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or description…"
                className="pl-8"
                aria-label="Search skills"
              />
            </div>
            <Select value={scope} onValueChange={(value) => setScope(value as ScopeFilter)}>
              <SelectTrigger className="w-36" aria-label="Filter by scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scopes</SelectItem>
                <SelectItem value="global">Global</SelectItem>
                <SelectItem value="scoped">Profile-scoped</SelectItem>
              </SelectContent>
            </Select>
            <Select value={format} onValueChange={(value) => setFormat(value as FormatFilter)}>
              <SelectTrigger className="w-32" aria-label="Filter by format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All formats</SelectItem>
                <SelectItem value="dir">Directory</SelectItem>
                <SelectItem value="file">File</SelectItem>
              </SelectContent>
            </Select>
            {allTags.length > 0 && (
              <Select value={activeTag} onValueChange={setTag}>
                <SelectTrigger className="w-36" aria-label="Filter by tag">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tags</SelectItem>
                  {allTags.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
              <SelectTrigger className="w-40" aria-label="Sort skills">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name (A–Z)</SelectItem>
                <SelectItem value="updated">Recently updated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No skills match your filters.</p>
          ) : (
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
                {visible.map((skill) => (
                  <TableRow key={skill.name}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Link to="/skills/$name" params={{ name: skill.name }} className="hover:underline">
                          {skill.name}
                        </Link>
                        {!skill.global && (
                          <Badge
                            variant="secondary"
                            className="font-normal"
                            title="Hidden from the root /mcp endpoint; served only on profiles that list it."
                          >
                            profile-scoped
                          </Badge>
                        )}
                        {skill.tags.map((t) => (
                          <Badge key={t} variant="outline" className="font-normal">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">
                      {skill.description || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1 font-normal">
                        {skill.format === 'dir' ? (
                          <FolderIcon className="size-3" />
                        ) : (
                          <FileTextIcon className="size-3" />
                        )}
                        {skill.format}
                        {skill.files.length > 0 &&
                          ` · ${skill.files.length} file${skill.files.length === 1 ? '' : 's'}`}
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
          )}

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
