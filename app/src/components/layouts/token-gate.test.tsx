import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenGate } from './token-gate';

const setToken = vi.fn();
const auth = { needsAuth: true };

vi.mock('@/lib/auth', () => ({
  setToken: (token: string) => setToken(token),
  useNeedsAuth: () => auth.needsAuth,
}));

/** The gate around a marker child, with the query client it refetches through. */
function renderGate() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <TokenGate>
        <p>the app</p>
      </TokenGate>
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe('TokenGate', () => {
  beforeEach(() => {
    setToken.mockReset();
    auth.needsAuth = true;
  });

  it('renders its children when no call has been refused', () => {
    auth.needsAuth = false;
    renderGate();

    expect(screen.getByText('the app')).toBeInTheDocument();
  });

  it('keeps Unlock disabled until a token that is not blank is typed', async () => {
    renderGate();

    expect(screen.queryByText('the app')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^Token/), '   ');
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^Token/), 'secret');
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeEnabled();
  });

  it('stores the trimmed token, clears the field and refetches', async () => {
    const { invalidate } = renderGate();

    await userEvent.type(screen.getByLabelText(/^Token/), '  secret  ');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(setToken).toHaveBeenCalledWith('secret'));
    expect(invalidate).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText(/^Token/)).toHaveValue(''));
  });
});
