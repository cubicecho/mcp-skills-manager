import { useMemo } from 'react';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError } from './api';

/**
 * Words a failure for a toast.
 *
 * @param error - What a request threw.
 * @returns The message, followed by the API's detail when there is one; a non-Error is stringified.
 *
 * @remarks
 * A toast is one line, so the detail follows the message rather than sitting under it.
 */
function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.detail ? `${error.message}: ${error.detail}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Gives a component the app's toasts.
 *
 * @returns `success` for a confirmation, `error` for a plain failure, and `apiError` for a failed request.
 */
export function useToasts() {
  const show = useToast();
  return useMemo(
    () => ({
      success: (message: string) => show(message, 'positive'),
      error: (message: string) => show(message),
      apiError: (error: unknown) => show(apiErrorMessage(error)),
    }),
    [show],
  );
}
