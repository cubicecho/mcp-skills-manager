import { useSyncSkill } from '@/lib/queries';
import { useToasts } from '@/lib/toast';

/** How much of a commit SHA is shown: enough to recognise it, as git's own short form. */
const SHORT_COMMIT_LENGTH = 7;

/**
 * Shorten a commit SHA for display.
 * @param commit - The full SHA.
 * @returns Its first seven characters.
 */
export function shortCommit(commit: string): string {
  return commit.slice(0, SHORT_COMMIT_LENGTH);
}

/**
 * Sync a linked skill from its git source, toasting what came of it.
 * @param name - The skill's slug.
 * @returns `sync` to start it, and `pending` while it runs.
 */
export function useSyncNow(name: string): { sync: () => void; pending: boolean } {
  const toast = useToasts();
  const syncSkill = useSyncSkill(name);
  const sync = () => {
    if (syncSkill.isPending) {
      return;
    }
    syncSkill.mutate(undefined, {
      onSuccess: ({ skill, changed }) => {
        const commit = skill.source?.commit;
        toast.success(changed && commit ? `Updated to ${shortCommit(commit)}` : 'Already up to date');
      },
      onError: toast.apiError,
    });
  };
  return { sync, pending: syncSkill.isPending };
}
