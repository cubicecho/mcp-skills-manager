// Every limit the schemas enforce, as plain data. Nothing here computes or imports.

/** How long the strings the schemas accept may be, in characters. */
export interface LengthLimits {
  /** A workspace's display name. */
  workspaceName: number;
  /** A path inside a skill's folder. */
  skillRelPath: number;
  /** A git repo URL a skill is linked to. */
  repoUrl: number;
  /** A git ref (branch, tag or commit) a skill is linked to. */
  gitRef: number;
  /** The folder inside the repo a skill is linked to. */
  sourcePath: number;
}

/** The length limits this build ships with. */
export const LENGTH_LIMITS: Readonly<LengthLimits> = Object.freeze({
  workspaceName: 100,
  skillRelPath: 255,
  repoUrl: 2048,
  gitRef: 255,
  sourcePath: 1024,
});

/** Most files one skill may hold when it is uploaded or fetched from a git source. */
export const MAX_SKILL_FILES = 500;

/** The port the server listens on when neither settings.json nor `PORT` names one. */
export const DEFAULT_PORT = 3000;
