// Beside the page's parts and not its route: the router plugin reads every file under routes/ as a route.
import type { SkillSummary } from '@mcp-skills/shared';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as SkillsRoute } from '@/routes/index';
import { A_SOURCE, aSkill } from '@/test/fixtures';

let skills: SkillSummary[] = [];
const updateSkill = vi.fn();

vi.mock('@/lib/queries', () => ({
  useSkills: () => ({ data: skills, isPending: false, isError: false, error: null, refetch: vi.fn() }),
  useServerStatus: () => ({ data: { port: 3001 } }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSkill: () => ({ mutate: updateSkill, isPending: false }),
}));

vi.mock('@/lib/toast', async () => (await import('@/test/toasts')).mockToasts());

const SKILLS = [
  aSkill({ name: 'review', description: 'Review a change', global: false, tags: ['style'] }),
  aSkill({ name: 'commits', description: 'Write commit messages', readOnly: true, source: A_SOURCE }),
  aSkill({ name: 'alpha', format: 'file', path: 'alpha.md' }),
];

async function renderPage() {
  const rootRoute = createRootRoute();
  const page = createRoute({ getParentRoute: () => rootRoute, path: '/', component: SkillsRoute.options.component });
  const skill = createRoute({ getParentRoute: () => rootRoute, path: '/skills/$name' });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page, skill]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Skills' });
}

const rowNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('link')[0]?.textContent);

describe('the skills page', () => {
  beforeEach(() => {
    skills = SKILLS;
    updateSkill.mockClear();
  });

  it('lists every skill by name, with what is known about each', async () => {
    await renderPage();

    expect(rowNames()).toEqual(['alpha', 'commits', 'review']);
    const commits = within(screen.getByRole('row', { name: /commits/ }));
    expect(commits.getByLabelText('Synced from a git repo')).toBeInTheDocument();
    expect(commits.getByLabelText('Read-only for agents')).toBeInTheDocument();
    expect(commits.getByRole('switch', { name: 'Serve "commits" on the root /mcp endpoint' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Serve "review" on the root /mcp endpoint' })).not.toBeChecked();
    expect(screen.getByText('http://localhost:3001/mcp')).toBeInTheDocument();
  });

  it('narrows the list as the search is typed, and clears every filter at once', async () => {
    await renderPage();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search skills' }), 'commit');
    expect(rowNames()).toEqual(['commits']);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search skills' }), 'zzz');
    expect(screen.getByText('No skills match your filters')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rowNames()).toEqual(['alpha', 'commits', 'review']);
    expect(screen.getByRole('searchbox', { name: 'Search skills' })).toHaveValue('');
  });

  it('offers a tag filter only when a skill has a tag', async () => {
    await renderPage();
    expect(screen.getByRole('combobox', { name: 'Filter by tag' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by scope' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sort skills' })).toBeInTheDocument();
  });

  it('turns a skill global from its row', async () => {
    await renderPage();

    await userEvent.click(screen.getByRole('switch', { name: 'Serve "review" on the root /mcp endpoint' }));

    expect(updateSkill.mock.calls[0]?.[0]).toEqual({ global: true });
  });

  it('asks for a first skill when there are none, without filters or an endpoint', async () => {
    skills = [];
    await renderPage();

    expect(screen.getByText('No skills yet')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Search skills' })).not.toBeInTheDocument();
    expect(screen.queryByText('http://localhost:3001/mcp')).not.toBeInTheDocument();
  });
});
