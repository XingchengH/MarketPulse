import { configureStore } from '@reduxjs/toolkit';
import { api } from './api';
import { sessionReducer } from './auth/session';
export const makeStore = () => configureStore({ reducer: { [api.reducerPath]: api.reducer, auth: sessionReducer }, middleware: getDefault => getDefault().concat(api.middleware) });
export const store = makeStore();
export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
