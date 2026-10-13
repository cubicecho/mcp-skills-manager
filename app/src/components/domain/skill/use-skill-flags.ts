import { useUpdateSkill } from '@/lib/queries';
import { useToasts } from '@/lib/toast';

/**
 * Switches a skill's two local flags, saying what changed once the server has it.
 * @param skillName - The skill the flags belong to.
 * @returns The two setters, and whether a change is still being saved.
 */
export function useSkillFlags(skillName: string) {
  const toast = useToasts();
  const update = useUpdateSkill(skillName);

  const setGlobal = (next: boolean) => {
    update.mutate(
      { global: next },
      {
        onSuccess: () =>
          toast.success(next ? 'Now served on the root /mcp endpoint' : 'Now workspace-scoped — hidden from root /mcp'),
        onError: toast.apiError,
      },
    );
  };

  const setReadOnly = (next: boolean) => {
    update.mutate(
      { readOnly: next },
      {
        onSuccess: () =>
          toast.success(next ? 'Now read-only — agents can no longer modify it' : 'Agents can modify this skill again'),
        onError: toast.apiError,
      },
    );
  };

  return { setGlobal, setReadOnly, isPending: update.isPending };
}
