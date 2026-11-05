import type { ErrorRequestHandler, RequestHandler } from 'express';

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

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const knownError = error instanceof HttpError;
  const status = knownError ? error.status : 500;
  response.status(status).json({
    error: {
      code: knownError ? error.code : 'INTERNAL_ERROR',
      message: knownError ? error.message : 'Internal server error',
      requestId: response.locals.requestId as string,
    },
  });
};
