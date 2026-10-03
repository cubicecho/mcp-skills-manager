import type { Skill, SkillToolMode } from '@mcp-skills/shared';
import type { ConfigStore } from '../config/store.ts';
import type { SkillServerDeps } from './skill-server.ts';

/** Which skills an endpoint serves and whether its transport can push notifications. */
export interface EndpointOptions {
  /** Serve only this workspace's skills; omit for the root aggregate of every global skill. */
  workspaceSlug?: string;
  /** True on a long-lived transport (stdio, stateful HTTP) that can push resource notifications. */
  liveUpdates: boolean;
}

/**
 * Build the skill-server dependencies for one endpoint, backed by the store.
 * @param store - The config store the endpoint reads skills from and authors into.
 * @param options - The workspace to scope to, if any, and whether the transport can push.
 * @returns The dependencies to pass to `createSkillServer`.
 */
export function endpointDeps(store: ConfigStore, options: EndpointOptions): SkillServerDeps {
  const { workspaceSlug, liveUpdates } = options;

  // Root aggregate: every globally-visible skill (skills flagged `global: false` are workspace-only).
  const getSkills = (): Skill[] => {
    if (!workspaceSlug) {
      return store.getGlobalSkills();
    }
    const workspace = store.getWorkspace(workspaceSlug);
    return workspace ? store.getSkillsForWorkspace(workspace) : [];
  };

  // A workspace endpoint honors that workspace's own mode override, falling back to the global default.
  const getSkillToolMode = (): SkillToolMode => {
    if (!workspaceSlug) {
      return store.getSkillToolMode();
    }
    const workspace = store.getWorkspace(workspaceSlug);
    return workspace ? store.getSkillToolModeForWorkspace(workspace) : store.getSkillToolMode();
  };

  // Push resources/list_changed + updated when the store reloads after an on-disk edit.
  const onSkillsChanged: SkillServerDeps['onSkillsChanged'] = (listener) => {
    store.on('change', listener);
    return () => store.off('change', listener);
  };

  return {
    label: workspaceSlug ?? 'all',
    getSkills,
    // Skills authored via a workspace endpoint are scoped to the workspace (global:false + added to it).
    authoring: { store, workspaceSlug },
    getSkillToolMode,
    readSupportingFile: (name, relPath) => store.readSupportingFile(name, relPath),
    onSkillLoaded: (name) => store.recordSkillUse(name),
    // A stateless server omits this so it never advertises capabilities it can't honor.
    ...(liveUpdates ? { onSkillsChanged } : {}),
  };
}
