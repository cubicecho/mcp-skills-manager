import type { SkillSummary } from '@mcp-skills/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { BookMarked, GitBranch } from '@/components/app-icons';
import { ConfirmButton } from '@/components/confirm-button';
import { ConnectCard } from '@/components/domain/connect-card';
import { NewSkillDialog } from '@/components/domain/skill/new-skill-dialog';
import { OptionSelect, type SelectEntry } from '@/components/option-select';
import { EmptyState } from '@/components/page';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Folder, Lock, Pencil, Plus, Search, Trash2 } from '@/components/ui/icons';
import { SearchInput } from '@/components/ui/search-input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCount, formatDate, joinStats } from '@/lib/format';
import { isKeyOf } from '@/lib/is-key-of';
import { mcpOrigin } from '@/lib/mcp';
import { useDeleteSkill, useServerStatus, useSkills, useUpdateSkill } from '@/lib/queries';
import {
  collectTags,
  FORMAT_LABELS,
  type FormatFilter,
  filterAndSort,
  SCOPE_LABELS,
  type ScopeFilter,
  SORT_LABELS,
  type SortKey,
} from '@/lib/skill-list';
import { ANY_TAG_OPTION, optionToTag, tagToOption } from '@/lib/tag-option';
import { useToasts } from '@/lib/toast';

export const Route = createFileRoute('/')({
  component: SkillsPage,
});

/**
 * Lists a label table as select options, in the table's order.
 * @param labels - Label by option value.
 * @returns One option per entry.
 */
function toOptions(labels: Readonly<Record<string, string>>): SelectEntry[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

const SCOPE_OPTIONS = toOptions(SCOPE_LABELS);
const FORMAT_OPTIONS = toOptions(FORMAT_LABELS);
const SORT_OPTIONS = toOptions(SORT_LABELS);

function DeleteSkillButton({ skill }: { skill: SkillSummary }) {
  const toast = useToasts();
  const remove = useDeleteSkill();
  return (
    <ConfirmButton
      variant="ghost"
      size="icon-sm"
      label={`Delete ${skill.name}`}
      title={`Delete skill "${skill.name}"?`}
      description={`This permanently removes the skill file${skill.format === 'dir' ? ' and its directory' : ''}. It will also be dropped from any workspace that references it.`}
      onConfirm={() => remove.mutate(skill.name, { onError: toast.apiError })}
      iconSlot={<Trash2 />}
    />
  );
}

/** Toggle whether a skill is served on the root /mcp endpoint (global) or hidden to its workspaces (scoped). */
function GlobalToggle({ skill }: { skill: SkillSummary }) {
  const toast = useToasts();
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
            onError: toast.apiError,
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
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<SortKey>('name');

  const allTags = useMemo(() => (data ? collectTags(data) : []), [data]);
  // A previously selected tag can disappear when skills change — fall back to no tag filter.
  const activeTag = tag !== undefined && allTags.includes(tag) ? tag : undefined;
  const visible = useMemo(
    () => (data ? filterAndSort(data, query, scope, format, activeTag, sort) : []),
    [data, query, scope, format, activeTag, sort],
  );
  const hasSkills = Boolean(data && data.length > 0);
  const clearFilters = () => {
    setQuery('');
    setScope('all');
    setFormat('all');
    setTag(undefined);
  };

  const newSkillButton = <Button onClick={() => setNewOpen(true)} content="New skill" iconSlot={<Plus />} />;

  const filters = hasSkills ? (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        wrapperClassName="w-64"
        label="Search skills"
        placeholder="Search name or description…"
        value={query}
        onChangeText={setQuery}
      />
      <OptionSelect
        className="w-40"
        aria-label="Filter by scope"
        options={SCOPE_OPTIONS}
        value={scope}
        onValueChange={(value) => {
          if (isKeyOf(SCOPE_LABELS, value)) {
            setScope(value);
          }
        }}
      />
      <OptionSelect
        className="w-40"
        aria-label="Filter by format"
        options={FORMAT_OPTIONS}
        value={format}
        onValueChange={(value) => {
          if (isKeyOf(FORMAT_LABELS, value)) {
            setFormat(value);
          }
        }}
      />
      {allTags.length > 0 && (
        <OptionSelect
          className="w-40"
          aria-label="Filter by tag"
          options={[
            { value: ANY_TAG_OPTION, label: 'All tags' },
            ...allTags.map((t) => ({ value: tagToOption(t), label: t })),
          ]}
          value={tagToOption(activeTag)}
          onValueChange={(value) => setTag(optionToTag(value))}
        />
      )}
      <OptionSelect
        className="w-40"
        aria-label="Sort skills"
        options={SORT_OPTIONS}
        value={sort}
        onValueChange={(value) => {
          if (isKeyOf(SORT_LABELS, value)) {
            setSort(value);
          }
        }}
      />
    </div>
  ) : undefined;

  return (
    <>
      <PageLayout
        title="Skills"
        description="Markdown documents served to agents over MCP. Each is exposed as both a tool and a resource."
        actionSlot={newSkillButton}
        headerContentSlot={filters}
        contentSlot={
          <div className="flex flex-col gap-6 pb-6">
            <QueryState
              query={skills}
              what="skills"
              count={visible.length}
              emptySlot={
                hasSkills ? (
                  <EmptyState
                    icon={Search}
                    title="No skills match your filters"
                    actionSlot={<Button variant="outline" onClick={clearFilters} content="Clear filters" />}
                  />
                ) : (
                  <EmptyState
                    icon={BookMarked}
                    title="No skills yet"
                    description="Create one, or upload a folder or zip you already have."
                    actionSlot={newSkillButton}
                  />
                )
              }
            />

            {visible.length > 0 && (
              <Table>
                <TableCaption className="sr-only">Skills</TableCaption>
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
                      <TableHead className="font-medium">
                        <div className="flex items-center gap-2">
                          <Link to="/skills/$name" params={{ name: skill.name }} className="hover:underline">
                            {skill.name}
                          </Link>
                          {skill.source && (
                            <GitBranch
                              className="size-3.5 shrink-0 text-muted-foreground"
                              aria-label="Synced from a git repo"
                            />
                          )}
                          {skill.readOnly && (
                            <Lock
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
                      </TableHead>
                      <TableCell className="max-w-md truncate text-muted-foreground">
                        {skill.description || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1 font-normal">
                          {skill.format === 'dir' ? <Folder className="size-3" /> : <FileText className="size-3" />}
                          {joinStats(skill.format, skill.files.length > 0 && formatCount(skill.files.length, 'file'))}
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
                          <ActionButton
                            variant="ghost"
                            size="icon-sm"
                            label={`Edit ${skill.name}`}
                            linkSlot={<Link to="/skills/$name" params={{ name: skill.name }} />}
                            iconSlot={<Pencil />}
                          />
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
