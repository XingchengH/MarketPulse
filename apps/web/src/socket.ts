import { io, type Socket } from 'socket.io-client';
import type { AppStore } from './store';
import { api, refreshSession, type SymbolSnapshot } from './api';

type LiveSocket = Pick<Socket, 'on' | 'close' | 'io'>;
export function bindSocket(store: AppStore, socket: LiveSocket): () => void {
  socket.on('symbols:snapshot', (value: SymbolSnapshot[]) => store.dispatch(api.util.updateQueryData('symbols', undefined, draft => {
    for (const snapshot of value) {
      const index = draft.symbols.findIndex(item => item.symbol === snapshot.symbol);
      if (index >= 0) draft.symbols[index] = snapshot;
      else draft.symbols.push(snapshot);
    }
  })));
  socket.on('provider:state', (value: { state: string }) => store.dispatch(api.util.updateQueryData('overview', undefined, draft => { draft.providerState = value.state; })));
  socket.on('alerts:changed', () => store.dispatch(api.util.invalidateTags(['Alerts'])));
  socket.on('rules:changed', () => store.dispatch(api.util.invalidateTags(['Rules'])));
  socket.on('watchlist:changed', () => store.dispatch(api.util.invalidateTags(['Watchlist', 'Overview', 'Symbols', 'Alerts'])));
  socket.io.on('reconnect', () => store.dispatch(api.util.invalidateTags(['Watchlist', 'Overview', 'Symbols', 'Alerts', 'Rules'])));
  return () => socket.close();
}
export function connectSocket(store: AppStore): () => void {
  const socket = io({ path: '/socket.io', withCredentials: true });
  const unbind = bindSocket(store, socket);
  let renewing = false;
  let closed = false;
  const renew = async () => {
    if (closed || renewing) return;
    renewing = true;
    try {
      if (await refreshSession() && !closed) {
        socket.disconnect();
        socket.connect();
      }
    } finally { renewing = false; }
  };
  socket.on('disconnect', reason => { if (reason === 'io server disconnect') void renew(); });
  const timer = window.setInterval(() => void renew(), 10 * 60 * 1000);
  return () => { closed = true; window.clearInterval(timer); unbind(); };
}
