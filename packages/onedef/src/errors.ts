/**
 * One error type every surface understands. A handler throws `fail('NOT_FOUND',
 * 'No such lesson')`; the REST/RPC host turns it into a 404, MCP into a tool
 * error the model can read, the CLI into a message and exit code, and every
 * client transport back into an `ApiError` with the same `code`.
 */

const STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
  UPSTREAM_ERROR: 502,
  UNAVAILABLE: 503,
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly data?: unknown

  constructor(code: string, message?: string, options?: { status?: number; data?: unknown; cause?: unknown }) {
    super(message ?? code, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ApiError'
    this.code = code
    const status = options?.status ?? STATUS[code] ?? 500
    // only error statuses: a 2xx/3xx here would be a bug that transports cannot represent
    this.status = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500
    if (options?.data !== undefined) this.data = options.data
  }
}

/** Throw a typed error from a handler: `return fail('NOT_FOUND', 'No such lesson')`. */
export function fail(code: string, message?: string, options?: { status?: number; data?: unknown }): never {
  throw new ApiError(code, message, options)
}

/** The error code for an HTTP status: the first code mapping to it, else UPSTREAM_ERROR. */
export const codeOf = (status: number): string =>
  Object.entries(STATUS).find(([, value]) => value === status)?.[0] ??
  (status >= 500 ? 'UPSTREAM_ERROR' : 'BAD_REQUEST')

/** The status code onedef uses for an error code. */
export const statusOf = (code: string): number => STATUS[code] ?? 500

export const isApiError = (error: unknown): error is ApiError =>
  error instanceof ApiError ||
  (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'ApiError')
