import type { Request } from 'express';
export interface Pagination { limit: number; page: number; skip: number }
export function parsePagination(request: Request): Pagination | null {
  const rawLimit = request.query.limit ?? '50', rawPage = request.query.page ?? '1';
  if (typeof rawLimit !== 'string' || typeof rawPage !== 'string' || !/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawPage)) return null;
  const limit = Number(rawLimit), page = Number(rawPage);
  if (limit < 1 || limit > 100 || page < 1 || page > 10_000) return null;
  return { limit, page, skip: (page - 1) * limit };
}
