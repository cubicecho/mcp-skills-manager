import { describe, expect, it } from 'vitest';
import { aSkill } from '@/test/fixtures';
import { skillFileCount, skillFilesPath, skillMarkdownPath } from './skill';

describe('skillFileCount', () => {
  it("counts the skill's own Markdown and its files, not its folders", () => {
    expect(skillFileCount(aSkill())).toBe(1);
    expect(
      skillFileCount(
        aSkill({
          files: [
            { path: 'docs', type: 'dir', size: 0 },
            { path: 'docs/a.md', type: 'file', size: 1 },
            { path: 'b.txt', type: 'file', size: 1 },
          ],
        }),
      ),
    ).toBe(3);
  });
});

describe('skill paths', () => {
  it('places a directory skill under its folder', () => {
    const skill = aSkill({ name: 'deploy', format: 'dir', path: 'deploy/SKILL.md' });
    expect(skillMarkdownPath(skill)).toBe('skills/deploy/SKILL.md');
    expect(skillFilesPath(skill)).toBe('skills/deploy/');
  });

  it('places a directory skill under the folder it is stored in, whatever the skill is called', () => {
    const skill = aSkill({ name: 'deploy', format: 'dir', path: 'Deploy Notes/SKILL.md' });
    expect(skillMarkdownPath(skill)).toBe('skills/Deploy Notes/SKILL.md');
    expect(skillFilesPath(skill)).toBe('skills/Deploy Notes/');
  });

  it('places a file skill at its one file', () => {
    const skill = aSkill({ name: 'deploy', format: 'file', path: 'deploy.md' });
    expect(skillMarkdownPath(skill)).toBe('skills/deploy.md');
    expect(skillFilesPath(skill)).toBe('skills/deploy.md');
  });
});
