import { z } from 'zod';

export const roleSchema = z.enum(['viewer', 'operator', 'admin']);

export type Role = z.infer<typeof roleSchema>;
