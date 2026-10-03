/**
 * Await a request, reporting a failure before rethrowing it, so a prompt dialog stays open on a failed request.
 * @param request - The request to await.
 * @param onError - Called with the failure, typically to toast it.
 * @returns The request's result.
 */
export async function reported<T>(request: Promise<T>, onError: (error: unknown) => void): Promise<T> {
  try {
    return await request;
  } catch (error) {
    onError(error);
    throw error;
  }
}
