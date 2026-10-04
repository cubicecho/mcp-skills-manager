import type { SkillDetail, SkillSource } from '@mcp-skills/shared';
import { Unlink } from '@/components/app-icons';
import { ConfirmButton } from '@/components/confirm-button';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { SkillFlags } from '@/components/domain/skill/editor/skill-flags';
import { shortCommit, useSyncNow } from '@/components/domain/skill/editor/use-sync-now';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { RefreshCw } from '@/components/ui/icons';
import { useUnlinkSkillSource } from '@/lib/queries';
import { useToasts } from '@/lib/toast';

/**
 * Format when a skill was last synced.
 * @param iso - The sync time as stored.
 * @returns A local date and time, or nothing when the time does not parse.
 */
function formatSyncedAt(iso: string | undefined): string | undefined {
  const date = iso ? new Date(iso) : undefined;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : undefined;
}

/**
 * Where a linked skill comes from and how to bring it up to date: its repo, ref, folder and synced
 * commit, a Sync now button, Unlink, and the local settings that survive a sync.
 * @param props.skill - The linked skill.
 * @param props.source - Its git source.
 */
export function SourcePanel({ skill, source }: { skill: SkillDetail; source: SkillSource }) {
  const toast = useToasts();
  const unlink = useUnlinkSkillSource(skill.name);
  const { sync, pending } = useSyncNow(skill.name);
  const syncedAt = formatSyncedAt(source.syncedAt);

  return (
    <Section
      title="Git source"
      description="This skill's content comes from a git repo, so it is not edited here. Sync it to pull the newest version."
      surface="card"
      className="mb-6"
      action={
        <>
          <Button size="sm" variant="outline" disabled={pending || unlink.isPending} onClick={sync}>
            <RefreshCw className={pending ? 'animate-spin' : undefined} /> {pending ? 'Syncing…' : 'Sync now'}
          </Button>
          <ConfirmButton
            variant="ghost"
            size="icon-sm"
            label="Unlink from Git"
            disabled={pending || unlink.isPending}
            title={`Unlink "${skill.name}" from its git source?`}
            description="The skill keeps the content it has now and becomes editable here and by agents, but it no longer follows the repo: later changes there are not pulled in."
            confirmLabel="Unlink"
            onConfirm={() =>
              unlink.mutate(undefined, {
                onSuccess: () => toast.success('Unlinked — the skill can be edited here again'),
                onError: toast.apiError,
              })
            }
          >
            <Unlink />
          </ConfirmButton>
        </>
      }
      content={
        <>
          <DescriptionList
            content={[
              <PropertyRow
                key="repo"
                label="Repository"
                value={<Code className="break-all">{source.repo}</Code>}
                action={<CopyButton value={source.repo} label="Copy repository URL" />}
              />,
              <PropertyRow key="ref" label="Branch or tag" value={source.ref ?? 'Default branch'} />,
              <PropertyRow
                key="path"
                label="Folder"
                value={source.path ? <Code className="break-all">{source.path}</Code> : 'Repo root'}
              />,
              <PropertyRow
                key="commit"
                label="Synced commit"
                value={source.commit ? <Code>{shortCommit(source.commit)}</Code> : 'Not synced yet'}
                hint={syncedAt ? `Synced ${syncedAt}` : undefined}
                action={source.commit ? <CopyButton value={source.commit} label="Copy full commit SHA" /> : undefined}
              />,
            ]}
          />
          <SkillFlags skill={skill} />
        </>
      }
    />
  );
}
