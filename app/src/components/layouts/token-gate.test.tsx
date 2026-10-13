import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenGate } from './token-gate';

const setToken = vi.fn();
const auth: { needsAuth: boolean; stored: string | null } = { needsAuth: true, stored: null };

vi.mock('@/lib/auth', () => ({
  getToken: () => auth.stored,
  setToken: (token: string) => setToken(token),
  useNeedsAuth: () => auth.needsAuth,
}));

/** The gate around a marker for the app, with the query client it refetches through. */
function renderGate() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <TokenGate contentSlot={<p>the app</p>} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe('TokenGate', () => {
  beforeEach(() => {
    setToken.mockReset();
    auth.needsAuth = true;
    auth.stored = null;
  });

  it('renders the app when no call has been refused', () => {
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

  it('asks for a token without complaint when none has been tried', () => {
    renderGate();

    expect(screen.queryByText('The server did not accept that token')).not.toBeInTheDocument();
  });

  it('says so when the stored token was refused', () => {
    auth.stored = 'wrong';
    renderGate();

    expect(screen.getByText('The server did not accept that token')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Token/)).toHaveValue('');
  });
});
