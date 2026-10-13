import { HttpStatus } from '@mcp-skills/shared';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../errors.ts';
import { errorMiddleware } from './error-middleware.ts';

/**
 * An app with one route that throws.
 * @param thrown - What the route throws.
 * @returns The app, with the error middleware mounted.
 */
function appThrowing(thrown: unknown) {
  const app = express();
  app.get('/', () => {
    throw thrown;
  });
  app.use(errorMiddleware);
  return app;
}

describe('errorMiddleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers an unexpected error with fixed text and keeps the cause in the log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error("ENOENT: no such file or directory, open '/data/config/settings.json'");

    const res = await request(appThrowing(cause)).get('/');

    expect(res.status).toBe(HttpStatus.InternalServerError);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(log).toHaveBeenCalledWith('Unhandled API error:', cause);
  });

  it('still sends the message of an error raised on purpose', async () => {
    const res = await request(appThrowing(new HttpError(HttpStatus.NotFound, 'Skill "x" not found'))).get('/');

    expect(res.status).toBe(HttpStatus.NotFound);
    expect(res.body).toEqual({ error: 'Skill "x" not found' });
  });
});
