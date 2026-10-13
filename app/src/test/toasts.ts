import { vi } from 'vitest';

/** The toast spies every mocked `useToasts()` hands out, so a test can assert on what was shown. */
export const toasts = { success: vi.fn(), error: vi.fn(), apiError: vi.fn() };

/**
 * A stand-in for `@/lib/toast` whose toasts are the `toasts` spies. `vi.mock` is hoisted above the
 * imports, so load this from inside its factory:
 * `vi.mock('@/lib/toast', async () => (await import('@/test/toasts')).mockToasts())`.
 * @returns The mocked module.
 */
export function mockToasts() {
  return { useToasts: () => toasts };
}
