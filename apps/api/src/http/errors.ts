import type { ErrorRequestHandler, RequestHandler } from 'express';

export interface ErrorLogger {
  error(details: { error: unknown; requestId: string }, message: string): void;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new HttpError(404, 'NOT_FOUND', 'Route not found'));
};

export function createErrorHandler(logger: ErrorLogger): ErrorRequestHandler {
  return (error, _request, response, _next) => {
    const requestId = response.locals.requestId as string;
    const knownError = error instanceof HttpError;
    if (!knownError) logger.error({ error, requestId }, 'Unexpected request error');

    response.status(knownError ? error.status : 500).json({
      error: {
        code: knownError ? error.code : 'INTERNAL_ERROR',
        message: knownError ? error.message : 'Internal server error',
        requestId,
      },
    });
  };
}
