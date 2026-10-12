/** The HTTP statuses the server sends, and its UI and tests read. */
export const HttpStatus = {
  Ok: 200,
  Created: 201,
  NoContent: 204,
  BadRequest: 400,
  Unauthorized: 401,
  NotFound: 404,
  Conflict: 409,
  InternalServerError: 500,
  BadGateway: 502,
} as const;
/** One of the {@link HttpStatus} codes. */
export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];

/** Milliseconds in a second. */
export const MS_PER_SECOND = 1000;
