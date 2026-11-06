import { io, type Socket } from 'socket.io-client';
import type { AppStore } from './store';
import { api, type Overview, type SymbolSnapshot } from './api';

type LiveSocket = Pick<Socket, 'on' | 'close' | 'io'>;
export function bindSocket(store: AppStore, socket: LiveSocket): () => void {
  socket.on('overview:snapshot', (value: Overview) => store.dispatch(api.util.updateQueryData('overview', undefined, draft => Object.assign(draft, value))));
  socket.on('symbols:snapshot', (value: SymbolSnapshot[]) => store.dispatch(api.util.updateQueryData('symbols', undefined, draft => { draft.symbols = value; })));
  socket.on('provider:state', (value: { state: string }) => store.dispatch(api.util.updateQueryData('overview', undefined, draft => { draft.providerState = value.state; })));
  socket.on('alerts:changed', () => store.dispatch(api.util.invalidateTags(['Alerts'])));
  socket.on('rules:changed', () => store.dispatch(api.util.invalidateTags(['Rules'])));
  socket.io.on('reconnect', () => store.dispatch(api.util.invalidateTags(['Overview', 'Symbols', 'Alerts', 'Rules'])));
  return () => socket.close();
}
export function connectSocket(store: AppStore): () => void { return bindSocket(store, io({ path: '/socket.io', withCredentials: true })); }
