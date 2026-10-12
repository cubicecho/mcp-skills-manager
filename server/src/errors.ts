import type { ApiError } from '@mcp-skills/shared';
import type { Response } from 'express';

/** An error carrying an HTTP status code; rendered by the API error middleware as { error, detail? }. */
export class HttpError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(status: number, message: string, detail?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }
}

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Like errorMessage, but appends an HttpError's detail, where the store puts the specifics of a failure.
 * @param err The thrown value.
 * @returns `message: detail` for an HttpError with a detail, else the plain message.
 */
export function errorDetailMessage(err: unknown): string {
  if (err instanceof HttpError && err.detail) {
    return `${err.message}: ${err.detail}`;
  }
  return errorMessage(err);
}

/**
 * Answer a request with the standard error envelope.
 * @param res - The response to end.
 * @param status - HTTP status code.
 * @param message - What went wrong, as the caller reads it.
 */
export function sendError(res: Response, status: number, message: string): void {
  const body: ApiError = { error: message };
  res.status(status).json(body);
}
