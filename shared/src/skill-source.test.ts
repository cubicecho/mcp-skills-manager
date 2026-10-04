import { describe, expect, it } from 'vitest';
import { gitSourceSchema, parseGitSourceUrl } from './skill-source.ts';

describe('parseGitSourceUrl', () => {
  it('splits a GitHub folder URL into repo, ref and folder', () => {
    expect(parseGitSourceUrl('https://github.com/cubicecho/cubeui/tree/main/skills/cubeui')).toEqual({
      repo: 'https://github.com/cubicecho/cubeui',
      ref: 'main',
      path: 'skills/cubeui',
    });
  });

  it('splits a GitLab folder URL, dropping the /-/ separator', () => {
    expect(parseGitSourceUrl('https://gitlab.com/group/sub/repo/-/tree/v1.2/skill')).toEqual({
      repo: 'https://gitlab.com/group/sub/repo',
      ref: 'v1.2',
      path: 'skill',
    });
  });

  it('leaves the folder out when the URL points at the root of a ref', () => {
    expect(parseGitSourceUrl('https://github.com/o/r/tree/main/')).toEqual({
      repo: 'https://github.com/o/r',
      ref: 'main',
    });
  });

  it('passes a plain clone URL through as the repo', () => {
    expect(parseGitSourceUrl(' https://github.com/o/r.git/ ')).toEqual({ repo: 'https://github.com/o/r.git' });
    expect(parseGitSourceUrl('git@github.com:o/r.git')).toEqual({ repo: 'git@github.com:o/r.git' });
  });
});

describe('gitSourceSchema', () => {
  it('accepts https and SSH repos', () => {
    for (const repo of ['https://github.com/o/r.git', 'ssh://git@host/o/r.git', 'git@github.com:o/r.git']) {
      expect(gitSourceSchema.safeParse({ repo }).success).toBe(true);
    }
  });

  it('rejects local paths, other protocols, options and embedded credentials', () => {
    for (const repo of [
      '/srv/repo',
      'file:///srv/repo',
      'http://github.com/o/r',
      '--upload-pack=evil',
      'ext::sh -c evil',
      'https://user:token@github.com/o/r',
      'https://token@github.com/o/r',
    ]) {
      expect(gitSourceSchema.safeParse({ repo }).success).toBe(false);
    }
  });

  it('trims slashes off the folder and rejects traversal', () => {
    const repo = 'https://github.com/o/r';
    expect(gitSourceSchema.parse({ repo, path: '/skills/cubeui/' }).path).toBe('skills/cubeui');
    expect(gitSourceSchema.safeParse({ repo, path: '../outside' }).success).toBe(false);
    expect(gitSourceSchema.safeParse({ repo, path: '/' }).success).toBe(false);
  });

  it('rejects a ref that would read as an option', () => {
    expect(gitSourceSchema.safeParse({ repo: 'https://github.com/o/r', ref: '--orphan' }).success).toBe(false);
  });
});
