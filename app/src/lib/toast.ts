import { useMemo } from 'react';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError } from './api';

/** A toast is one line, so the API's detail follows the message rather than sitting under it. */
function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.detail ? `${error.message}: ${error.detail}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The app's toasts: a confirmation, a plain failure, and a failed request with the API detail when present. */
export function useToasts() {
  const show = useToast();
  return useMemo(
    () => ({
      success: (message: string) => show(message, 'success'),
      error: (message: string) => show(message),
      apiError: (error: unknown) => show(apiErrorMessage(error)),
    }),
    [show],
  );
}
