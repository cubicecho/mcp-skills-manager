import type { SkillSummary } from '@mcp-skills/shared';
import { Link } from '@tanstack/react-router';
import { ActionButton } from '@/components/action-button';
import { DeleteButton } from '@/components/domain/delete-button';
import { useSkillFlags } from '@/components/domain/skill/use-skill-flags';
import { Badge } from '@/components/ui/badge';
import { FileText, Folder, Pencil } from '@/components/ui/icons';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCount, formatDate, joinStats } from '@/lib/format';
import { useDeleteSkill } from '@/lib/queries';
import { SKILL_STATUS, skillStatuses } from '@/lib/skill-status';
import { useToasts } from '@/lib/toast';

/** Deletes the row's skill, once the reader has confirmed it. */
function DeleteSkillButton({ skill }: { skill: SkillSummary }) {
  const toast = useToasts();
  const remove = useDeleteSkill();
  return (
    <DeleteButton
      name={skill.name}
      title={`Delete skill "${skill.name}"?`}
      description={`This permanently removes the skill file${skill.format === 'dir' ? ' and its directory' : ''}. It will also be dropped from any workspace that references it.`}
      onConfirm={() => remove.mutate(skill.name, { onError: toast.apiError })}
    />
  );
}

/** Toggle whether a skill is served on the root /mcp endpoint (global) or hidden to its workspaces (scoped). */
function GlobalToggle({ skill }: { skill: SkillSummary }) {
  const flags = useSkillFlags(skill.name);
  return (
    <Switch
      checked={skill.global}
      disabled={flags.isPending}
      aria-label={`Serve "${skill.name}" on the root /mcp endpoint`}
      title={
        skill.global
          ? 'Served on the root /mcp endpoint. Turn off to make it workspace-scoped.'
          : 'Hidden from the root /mcp endpoint; served only on workspaces that list it. Turn on to serve globally.'
      }
      onCheckedChange={flags.setGlobal}
    />
  );
}

/** One row per skill: its name, status marks and tags, how it is used, and its global switch and actions. */
export function SkillsTable({ skills }: { skills: SkillSummary[] }) {
  return (
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
        {skills.map((skill) => (
          <TableRow key={skill.name}>
            <TableHead className="font-medium">
              <div className="flex items-center gap-2">
                <Link to="/skills/$name" params={{ name: skill.name }} className="hover:underline">
                  {skill.name}
                </Link>
                {skillStatuses(skill)
                  .filter((status) => status !== 'scoped')
                  .map((status) => {
                    const { hint, icon: Icon } = SKILL_STATUS[status];
                    return <Icon key={status} className="size-3.5 shrink-0 text-muted-foreground" aria-label={hint} />;
                  })}
                {skill.tags.map((t) => (
                  <Badge key={t} variant="outline" className="font-normal">
                    {t}
                  </Badge>
                ))}
              </div>
            </TableHead>
            <TableCell className="max-w-md truncate text-muted-foreground">{skill.description || '—'}</TableCell>
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
  );
}
