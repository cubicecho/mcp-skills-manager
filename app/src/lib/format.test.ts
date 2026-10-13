import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount, formatDate, formatDateTime, formatDuration, joinStats } from './format';

describe('formatBytes', () => {
  it('shows bytes whole below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('shows kilobytes, megabytes and gigabytes to one decimal place, 1024 to a step', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.0 GB');
    expect(formatBytes(4096 * 1024 * 1024 * 1024)).toBe('4096.0 GB');
  });
});

describe('formatCount', () => {
  it('pluralises the noun for anything but one', () => {
    expect(formatCount(0, 'file')).toBe('0 files');
    expect(formatCount(1, 'file')).toBe('1 file');
    expect(formatCount(2, 'file')).toBe('2 files');
  });

  it('groups the digits of a large count', () => {
    expect(formatCount(1204, 'time')).toBe(`${(1204).toLocaleString()} times`);
  });
});

describe('joinStats', () => {
  it('joins the facts that apply with a middle dot', () => {
    expect(joinStats('dir', false, '3 files', undefined, '')).toBe('dir · 3 files');
    expect(joinStats(false)).toBe('');
  });
});

describe('formatDateTime', () => {
  it('shows a medium date and a short time, and nothing for a timestamp that does not parse', () => {
    const iso = '2026-10-03T12:00:00.000Z';
    expect(formatDateTime(iso)).toBe(
      new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    );
    expect(formatDateTime('not a date')).toBe('');
  });
});

describe('formatDuration', () => {
  it('shows the two largest units', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(42.9)).toBe('42s');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(59 * 60 + 59)).toBe('59m');
    expect(formatDuration(3 * 3600 + 12 * 60)).toBe('3h 12m');
    expect(formatDuration(2 * 86400 + 4 * 3600 + 30 * 60)).toBe('2d 4h');
  });
});

describe('formatDate', () => {
  it('shows a medium-length local date', () => {
    const iso = '2026-10-03T12:00:00.000Z';
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }));
    expect(formatDate(iso)).toContain('2026');
  });

  it('shows nothing for a timestamp that does not parse', () => {
    expect(formatDate('not a date')).toBe('');
    expect(formatDate('')).toBe('');
  });
});
