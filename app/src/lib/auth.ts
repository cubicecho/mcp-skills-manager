import { useSyncExternalStore } from 'react';

/**
 * Bearer-token storage plus a tiny external store for the "needs auth" flag.
 * The fetch wrapper flips the flag on any 401; the root layout watches it and
 * swaps in the token-entry screen.
 */

/** The localStorage key the bearer token is kept under. */
export const TOKEN_STORAGE_KEY = 'mcp-skills-token';

/** Called when the needs-auth flag changes. */
type Listener = () => void;

let needsAuth = false;
const listeners = new Set<Listener>();

/** Calls every listener of the needs-auth flag. */
function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Reads the stored bearer token.
 *
 * @returns The token, or null when none is stored.
 */
export function getToken(): string | null {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

/**
 * Stores the bearer token and clears the needs-auth flag, telling listeners when it was set.
 *
 * @param token - The token to store.
 */
export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  if (needsAuth) {
    needsAuth = false;
    emit();
  }
}

/** Removes the stored bearer token; the needs-auth flag is left as it is. */
export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

/** Raises the needs-auth flag and tells listeners; the API client calls it whenever a request comes back 401. */
export function requireAuth(): void {
  if (!needsAuth) {
    needsAuth = true;
    emit();
  }
}

/**
 * Reads the needs-auth flag.
 *
 * @returns True once a request has come back 401 and no token has been stored since.
 */
export function getNeedsAuth(): boolean {
  return needsAuth;
}

/**
 * Subscribes to changes of the needs-auth flag.
 *
 * @param listener - Called on every change.
 * @returns A function that ends the subscription.
 */
export function subscribeNeedsAuth(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribes a component to the needs-auth flag.
 *
 * @returns The flag's current value.
 */
export function useNeedsAuth(): boolean {
  return useSyncExternalStore(subscribeNeedsAuth, getNeedsAuth);
}
