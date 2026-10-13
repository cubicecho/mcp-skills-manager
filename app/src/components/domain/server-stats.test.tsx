import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ServerStats } from './server-stats';

const STATUS = { skillCount: 2, workspaceCount: 1, version: '1.0.0', uptimeSeconds: 60 };
let status: { data?: typeof STATUS; isPending: boolean; isError: boolean };

vi.mock('@/lib/queries', () => ({
  useServerStatus: () => status,
  useSkills: () => ({ data: [] }),
}));

describe('ServerStats', () => {
  it('says it is loading until the status arrives', () => {
    status = { isPending: true, isError: false };
    render(<ServerStats />);

    expect(screen.getByRole('status', { name: 'Loading the server status' })).toBeInTheDocument();
  });

  it('says what the server is serving', () => {
    status = { data: STATUS, isPending: false, isError: false };
    render(<ServerStats />);

    expect(screen.getByText('Serving 2 skills')).toBeInTheDocument();
    expect(screen.getByText(/1 workspace/)).toBeInTheDocument();
  });

  it('says the server is unreachable when a poll fails, whatever it fetched before', () => {
    status = { data: STATUS, isPending: false, isError: true };
    render(<ServerStats />);

    expect(screen.getByText('Server unreachable')).toBeInTheDocument();
    expect(screen.queryByText(/1 workspace/)).not.toBeInTheDocument();
  });
});
