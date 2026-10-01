import type { SkillSummary } from '@mcp-skills/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  BookMarkedIcon,
  FileTextIcon,
  FolderIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { ConnectCard } from '@/components/domain/connect-card';
import { NewSkillDialog } from '@/components/domain/skill/new-skill-dialog';
import { OptionSelect, type SelectEntry } from '@/components/option-select';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { mcpOrigin } from '@/lib/mcp';
import { useDeleteSkill, useServerStatus, useSkills, useUpdateSkill } from '@/lib/queries';
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
type SortKey = 'name' | 'updated' | 'used';

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
  return matched.sort((a, b) => {
    if (sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt);
    if (sort === 'used') return b.usage.count - a.usage.count || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
}

/** All distinct tags across the skill list, sorted for a stable filter dropdown. */
function collectTags(skills: SkillSummary[]): string[] {
  return [...new Set(skills.flatMap((skill) => skill.tags))].sort((a, b) => a.localeCompare(b));
}

const SCOPE_OPTIONS: SelectEntry[] = [
  { value: 'all', label: 'All scopes' },
  { value: 'global', label: 'Global' },
  { value: 'scoped', label: 'Workspace-scoped' },
];

const FORMAT_OPTIONS: SelectEntry[] = [
  { value: 'all', label: 'All formats' },
  { value: 'dir', label: 'Directory' },
  { value: 'file', label: 'File' },
];

const SORT_OPTIONS: SelectEntry[] = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'used', label: 'Most used' },
];

function DeleteSkillButton({ skill }: { skill: SkillSummary }) {
  const remove = useDeleteSkill();
  return (
    <ConfirmButton
      variant="ghost"
      size="icon-sm"
      label={`Delete ${skill.name}`}
      title={`Delete skill "${skill.name}"?`}
      description={`This permanently removes the skill file${skill.format === 'dir' ? ' and its directory' : ''}. It will also be dropped from any workspace that references it.`}
      onConfirm={() => remove.mutate(skill.name, { onError: toastApiError })}
    >
      <Trash2Icon />
    </ConfirmButton>
  );
}

/** Toggle whether a skill is served on the root /mcp endpoint (global) or hidden to its workspaces (scoped). */
function GlobalToggle({ skill }: { skill: SkillSummary }) {
  const update = useUpdateSkill(skill.name);
  return (
    <Switch
      checked={skill.global}
      disabled={update.isPending}
      aria-label={`Serve "${skill.name}" on the root /mcp endpoint`}
      title={
        skill.global
          ? 'Served on the root /mcp endpoint. Turn off to make it workspace-scoped.'
          : 'Hidden from the root /mcp endpoint; served only on workspaces that list it. Turn on to serve globally.'
      }
      onCheckedChange={(next) =>
        update.mutate(
          { global: next },
          {
            onSuccess: () =>
              toast.success(
                next ? 'Now served on the root /mcp endpoint' : 'Now workspace-scoped — hidden from root /mcp',
              ),
            onError: toastApiError,
          },
        )
      }
    />
  );
}

function SkillsPage() {
  const skills = useSkills();
  const { data } = skills;
  const { data: status } = useServerStatus();
  const [newOpen, setNewOpen] = useState(false);
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
  const hasSkills = Boolean(data && data.length > 0);

  const newSkillButton = (
    <Button onClick={() => setNewOpen(true)}>
      <PlusIcon /> New skill
    </Button>
  );

  const filters = hasSkills ? (
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
      <OptionSelect
        className="w-36"
        aria-label="Filter by scope"
        options={SCOPE_OPTIONS}
        value={scope}
        onValueChange={(value) => setScope(value as ScopeFilter)}
      />
      <OptionSelect
        className="w-32"
        aria-label="Filter by format"
        options={FORMAT_OPTIONS}
        value={format}
        onValueChange={(value) => setFormat(value as FormatFilter)}
      />
      {allTags.length > 0 && (
        <OptionSelect
          className="w-36"
          aria-label="Filter by tag"
          options={[{ value: 'all', label: 'All tags' }, ...allTags.map((t) => ({ value: t, label: t }))]}
          value={activeTag}
          onValueChange={setTag}
        />
      )}
      <OptionSelect
        className="w-40"
        aria-label="Sort skills"
        options={SORT_OPTIONS}
        value={sort}
        onValueChange={(value) => setSort(value as SortKey)}
      />
    </div>
  ) : undefined;

  return (
    <>
      <PageLayout
        title="Skills"
        description="Markdown documents served to agents over MCP. Each is exposed as both a tool and a resource."
        action={newSkillButton}
        headerContent={filters}
        content={
          <div className="flex flex-col gap-6 pb-6">
            <QueryState
              query={skills}
              what="skills"
              count={visible.length}
              empty={
                hasSkills ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No skills match your filters.</p>
                ) : (
                  <CardLayout
                    contentClassName="flex flex-col items-center gap-3 py-6 text-center"
                    content={
                      <>
                        <BookMarkedIcon className="size-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">No skills yet.</p>
                        {newSkillButton}
                      </>
                    }
                  />
                )
              }
            />

            {visible.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead className="text-right">Uses</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-center">Global</TableHead>
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
                          {skill.readOnly && (
                            <LockIcon
                              className="size-3.5 shrink-0 text-muted-foreground"
                              aria-label="Read-only for agents"
                            />
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
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {skill.usage.count > 0 ? skill.usage.count : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {skill.usage.lastUsedAt ? formatDate(skill.usage.lastUsedAt) : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(skill.updatedAt)}</TableCell>
                      <TableCell className="text-center">
                        <GlobalToggle skill={skill} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <ActionButton variant="ghost" size="icon-sm" asChild label={`Edit ${skill.name}`}>
                            <Link to="/skills/$name" params={{ name: skill.name }}>
                              <PencilIcon />
                            </Link>
                          </ActionButton>
                          <DeleteSkillButton skill={skill} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {hasSkills && (
              <ConnectCard
                endpoint={`${mcpOrigin(status?.port)}/mcp`}
                label="all skills"
                description="Point an MCP client at this endpoint to get every skill as a tool and a resource. Use a workspace endpoint (/mcp/w/<slug>) to serve a filtered subset."
              />
            )}
          </div>
        }
      />
      {newOpen && <NewSkillDialog open onOpenChange={setNewOpen} />}
    </>
  );
}
