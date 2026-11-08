import { createSlice } from '@reduxjs/toolkit';

// Keep explicit sign-out separate from query cache state so resetting the API
// cannot mount the workspace or renew the session again before Google sign-in.
const session = createSlice({
  name: 'auth',
  initialState: { sessionEnded: false },
  reducers: { sessionEnded(state) { state.sessionEnded = true; } },
});
export const { sessionEnded } = session.actions;
export const sessionReducer = session.reducer;
