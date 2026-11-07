# Google OAuth setup

1. In Google Cloud, create or select a project and configure the OAuth consent screen.
2. Create an **OAuth client ID** with application type **Web application**.
3. Add the authorized JavaScript origin `http://localhost:5173`.
4. Add the authorized redirect URI exactly as `http://localhost:3000/api/auth/google/callback` (including scheme, port, and path).
5. Put the client ID and client secret in server-side `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Set `GOOGLE_REDIRECT_URI` to the exact URI above.
6. Restart the API and confirm `/api/setup/status` reports Google OAuth ready. Complete a real sign-in and verify the callback returns to the dashboard.

For production, use HTTPS origins and a production callback registered separately. Do not expose the client secret in browser code, logs, screenshots, Docker images, or source control.
