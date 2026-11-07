import { configureStore } from '@reduxjs/toolkit';
import { api } from './api';
export const makeStore = () => configureStore({ reducer: { [api.reducerPath]: api.reducer }, middleware: getDefault => getDefault().concat(api.middleware) });
export const store = makeStore();
export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
