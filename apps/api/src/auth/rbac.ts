import type { Role } from '@marketpulse/contracts';

const rank: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };
export const hasRole = (actual: Role, required: Role): boolean => rank[actual] >= rank[required];
