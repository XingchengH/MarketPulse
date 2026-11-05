import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const requestContext: RequestHandler = (request, response, next) => {
  const suppliedId = request.get('x-request-id');
  const requestId = suppliedId && suppliedId.length <= 128 ? suppliedId : randomUUID();
  response.locals.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
};
