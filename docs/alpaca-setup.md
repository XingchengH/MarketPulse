# Alpaca setup

1. Create an Alpaca account and generate paper-account API credentials.
2. Put the key and secret only in server-side `.env` as `ALPACA_API_KEY` and `ALPACA_API_SECRET`.
3. Start the API and confirm the dashboard reports **Connected to Alpaca IEX** after authentication and subscription.

The configured stream uses Alpaca's IEX feed. IEX is available on Alpaca's free market-data plan but represents IEX activity, not the consolidated US market. SIP provides consolidated exchange coverage and requires the appropriate paid Alpaca market-data entitlement. Do not describe IEX volume, prices, or latency as full-market SIP data.

MarketPulse does not fabricate events when credentials are missing, authentication fails, the provider disconnects, or the market is closed. Those states must remain explicit. A passing controlled E2E test uses a fake provider and does not verify live Alpaca credentials or entitlements.
