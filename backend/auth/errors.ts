export class AuthServiceError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "AuthServiceError";
    this.status = status;
    this.details = details;
  }
}

export function ensureSuccess<T extends { ok: boolean; status: number; data: unknown }>(
  response: T,
  context: string
): asserts response is T & { ok: true } {
  if (!response.ok) {
    throw new AuthServiceError(
      `${context} failed with status ${response.status}`,
      response.status,
      response.data
    );
  }
}
