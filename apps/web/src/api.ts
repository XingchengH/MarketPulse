import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs } from '@reduxjs/toolkit/query';
import type { Role, RuleInput } from '@marketpulse/contracts';

export type ServiceState = 'ready' | 'missing' | 'unavailable' | 'unconfigured' | 'connecting' | 'connected' | 'reconnecting' | 'market_closed' | 'outside_session' | 'auth_rejected' | 'rate_limited';
export interface SetupStatus { configured: boolean; services: Record<'mongodb' | 'googleOAuth' | 'alpaca' | 'tokens', ServiceState> }
export interface User { id: string; email: string; name: string; picture?: string; role: Role; lastLoginAt?: string }
export interface Overview { provider: string; providerState: string; symbols: string[] }
export interface SymbolSnapshot { symbol: string; feed: string | null; latestTrade?: { price: number }; latestQuote?: { bid: number; ask: number }; spread?: number; receivedMessagesPerSecond: number; lastEventAt: string | null; observedLatency: { latest: number; p95: number }; staleDurationMs: number; providerErrors: number; reconnects: number; marketClock?: { isOpen: boolean; status?: 'current' | 'degraded'; staleAgeMs?: number } | null; marketClockStatus?: 'current' | 'degraded' | 'unavailable' }
export interface WatchlistItem { _id: string; symbol: string; enabled: boolean; createdAt: string; updatedAt: string }
export interface Alert { _id: string; symbol: string; metric: string; severity: string; status: string; value: number; threshold: number; lastObservedAt: string; acknowledgedAt?: string; acknowledgedBy?: string }
export interface Rule extends RuleInput { _id: string; version: number; updatedAt: string }
export interface RuleVersion { _id?: string; ruleId: string; version: number; snapshot: RuleInput; actorId: string; createdAt: string }
export interface AuditEvent { _id: string; actorId: string; action: string; resourceType: string; resourceId: string; before?: unknown; after?: unknown; createdAt: string }
export interface ApiError { status: number | string; data?: { error?: { code?: string; message?: string } } }

const httpBaseQuery: BaseQueryFn<string | FetchArgs, unknown, ApiError> = async value => {
  const args = typeof value === 'string' ? { url: value } : value;
  const url = new URL(`/api${args.url}`, location.origin);
  for (const [key, item] of Object.entries(args.params ?? {})) if (item !== undefined) url.searchParams.set(key, String(item));
  try {
    const response = await fetch(url.pathname + url.search, { method: args.method, headers: args.body ? { 'Content-Type': 'application/json' } : undefined, body: args.body ? JSON.stringify(args.body) : undefined, credentials: 'include' });
    const data = response.status === 204 ? undefined : await response.json();
    return response.ok ? { data } : { error: { status: response.status, data } };
  } catch { return { error: { status: 'FETCH_ERROR' } }; }
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: httpBaseQuery,
  tagTypes: ['Overview', 'Symbols', 'Watchlist', 'Users', 'Alerts', 'Rules', 'Audit'],
  endpoints: build => ({
    setupStatus: build.query<SetupStatus, void>({ query: () => '/setup/status' }),
    session: build.query<{ user: User }, void>({ query: () => '/auth/me' }),
    overview: build.query<Overview, void>({ query: () => '/overview', providesTags: ['Overview'] }),
    symbols: build.query<{ symbols: SymbolSnapshot[] }, void>({ query: () => '/symbols', providesTags: ['Symbols'] }),
    symbol: build.query<SymbolSnapshot, string>({ query: symbol => `/symbols/${symbol}`, providesTags: ['Symbols'] }),
    watchlist: build.query<{ watchlist: WatchlistItem[] }, void>({ query: () => '/watchlist', providesTags: ['Watchlist'] }),
    addWatchlistSymbol: build.mutation<{ watchlist: WatchlistItem[] }, string>({ query: symbol => ({ url: '/watchlist', method: 'POST', body: { symbol } }), invalidatesTags: ['Watchlist', 'Overview', 'Symbols'] }),
    removeWatchlistSymbol: build.mutation<{ watchlist: WatchlistItem[] }, string>({ query: symbol => ({ url: `/watchlist/${encodeURIComponent(symbol)}`, method: 'DELETE' }), invalidatesTags: ['Watchlist', 'Overview', 'Symbols'] }),
    users: build.query<{ users: User[] }, void>({ query: () => '/admin/users', providesTags: ['Users'] }),
    updateUserRole: build.mutation<{ user: User }, { id: string; role: Role }>({ query: ({ id, role }) => ({ url: `/admin/users/${id}/role`, method: 'PATCH', body: { role } }), invalidatesTags: ['Users'] }),
    metrics: build.query<{ metrics: unknown[] }, { symbol: string; from?: string; to?: string }>({ query: p => ({ url: '/metrics', params: { ...p, interval: '1m' } }) }),
    alerts: build.query<{ alerts: Alert[] }, string | void>({ query: status => ({ url: '/alerts', params: status ? { status } : undefined }), providesTags: ['Alerts'] }),
    acknowledgeAlert: build.mutation<{ alert: Alert }, string>({ query: id => ({ url: `/alerts/${id}/acknowledge`, method: 'POST' }), invalidatesTags: ['Alerts', 'Audit'] }),
    rules: build.query<{ rules: Rule[] }, void>({ query: () => '/rules', providesTags: ['Rules'] }),
    ruleVersions: build.query<{ versions: RuleVersion[] }, string>({ query: id => `/rules/${id}/versions` }),
    createRule: build.mutation<{ rule: Rule }, RuleInput>({ query: body => ({ url: '/rules', method: 'POST', body }), invalidatesTags: ['Rules', 'Audit'] }),
    updateRule: build.mutation<{ rule: Rule }, { id: string; version: number; rule: RuleInput }>({ query: ({ id, ...body }) => ({ url: `/rules/${id}`, method: 'PUT', body }), invalidatesTags: ['Rules', 'Audit'] }),
    toggleRule: build.mutation<{ rule: Rule }, { id: string; version: number; enabled: boolean }>({ query: ({ id, ...body }) => ({ url: `/rules/${id}/toggle`, method: 'PATCH', body }), invalidatesTags: ['Rules', 'Audit'] }),
    rollbackRule: build.mutation<{ rule: Rule }, { id: string; version: number; targetVersion: number }>({ query: ({ id, ...body }) => ({ url: `/rules/${id}/rollback`, method: 'POST', body }), invalidatesTags: ['Rules', 'Audit'] }),
    audit: build.query<{ events: AuditEvent[] }, void>({ query: () => '/audit', providesTags: ['Audit'] }),
  }),
});

export const { useSetupStatusQuery, useSessionQuery, useOverviewQuery, useSymbolsQuery, useSymbolQuery, useWatchlistQuery, useAddWatchlistSymbolMutation, useRemoveWatchlistSymbolMutation, useUsersQuery, useUpdateUserRoleMutation, useMetricsQuery, useAlertsQuery, useAcknowledgeAlertMutation, useRulesQuery, useRuleVersionsQuery, useCreateRuleMutation, useUpdateRuleMutation, useToggleRuleMutation, useRollbackRuleMutation, useAuditQuery } = api;
