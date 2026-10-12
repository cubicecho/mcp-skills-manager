import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys, useReloadConfig } from './queries';

vi.mock('./api', () => ({
  reloadConfig: vi.fn(async () => ({ reloaded: true, skillCount: 2, workspaceCount: 1 })),
}));

describe('useReloadConfig', () => {
  it('marks every cached resource stale once the server has reloaded', async () => {
    const queryClient = new QueryClient();
    const cached = [queryKeys.status, queryKeys.settings, queryKeys.skill('demo'), queryKeys.workspaces];
    for (const key of cached) {
      queryClient.setQueryData(key, {});
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useReloadConfig(), { wrapper });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({ skillCount: 2, workspaceCount: 1 });
    expect(cached.map((key) => queryClient.getQueryState(key)?.isInvalidated)).toEqual([true, true, true, true]);
  });
});
