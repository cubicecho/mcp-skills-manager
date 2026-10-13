import type { ApiError } from '@mcp-skills/shared';
import type { Response } from 'express';

/** An error carrying an HTTP status code; rendered by the API error middleware as { error, detail? }. */
export class HttpError extends Error {
  /** HTTP status code to answer with. */
  readonly status: number;
  /** The specifics of the failure, sent beside the message when present. */
  readonly detail?: string;

  /**
   * Builds an error the API error middleware answers with `status`.
   *
   * @param status - HTTP status code.
   * @param message - What went wrong, as the caller reads it.
   * @param [detail] - The specifics, sent as the envelope's `detail`.
   * @param [options] - Standard error options, such as the `cause`.
   */
  constructor(status: number, message: string, detail?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Extracts a human-readable message from an unknown thrown value.
 *
 * @param err - The thrown value.
 * @returns An Error's `message`; anything else converted with `String`.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Extracts a message as `errorMessage` does, and appends an HttpError's detail, where the specifics of a failure go.
 *
 * @param err - The thrown value.
 * @returns `message: detail` for an HttpError with a detail, else the plain message.
 */
export function errorDetailMessage(err: unknown): string {
  if (err instanceof HttpError && err.detail) {
    return `${err.message}: ${err.detail}`;
  }
  return errorMessage(err);
}

/**
 * Answers a request with the standard error envelope.
 *
 * @param res - The response to end.
 * @param status - HTTP status code.
 * @param message - What went wrong, as the caller reads it.
 */
export function sendError(res: Response, status: number, message: string): void {
  const body: ApiError = { error: message };
  res.status(status).json(body);
}
