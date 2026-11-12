# Rem'z AI Trading Powered by Claude

The public website, hosted Claude signal API, and MT5 Expert Advisor are included
in this repository. Trades execute locally in each user's own MT5 terminal.

## Deploy the website to Vercel

Import this GitHub repository into Vercel and set the project **Root Directory**
to the repository root (`.`). The root [`vercel.json`](vercel.json) routes the
homepage, dashboard, animation script, and EA downloads from `website/`.
`api/health.js`, `api/config.js`, `api/status.js`, and `api/signal.js` provide
the hosted API. The dashboard status panel shows signal requests, recent
signals and errors, execution results, and the most recent MT5 EA heartbeat
for the current public IP; no broker account or position details are collected.
No build command is required. `api/config.js` stores the encrypted per-public-IP
API key, lot size, and model
in Upstash Redis. The signal function is configured for a 60-second maximum
duration to allow the optional one-time HOLD retry. Deploy the `main` branch.

### Configure hosted settings storage

Connect an Upstash Redis database to the Vercel project and set these production
environment variables in **Vercel → Project Settings → Environment Variables**:

- `UPSTASH_REDIS_REST_URL` — the database's HTTPS REST URL.
- `UPSTASH_REDIS_REST_TOKEN` — its REST token.
- `CONFIG_ENCRYPTION_KEY` — a private, persistent 32-byte key encoded as 64
  hexadecimal characters. Generate one locally with
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

Never commit these values or send them in chat. Redeploy after setting them.
Without them the hosted dashboard displays that storage is unavailable and
cannot save settings. Do not rotate `CONFIG_ENCRYPTION_KEY` while saved settings
are needed: encrypted API keys become unreadable.

## Use the hosted signal service

1. In MT5, allow `https://remzaitrading.vercel.app` under **Tools → Options →
   Expert Advisors → Allow WebRequest for listed URL**.
2. Open `/dashboard` over the same Wi-Fi as MT5, enter your API key and desired
   lot size, and save. This claims the API key for that network's public IP.
3. Attach the updated Expert Advisor to an M5 chart and keep
   `InpUseHostedService` enabled. The EA retrieves the saved lot and model
   settings from the hosted service.
4. Keep your broker login exclusively in your own MT5 terminal. The hosted
   service receives market-analysis data and a signal request only; it does not
   receive credentials or execute orders.

Each API key can be claimed by only one public IP. A Wi-Fi's public IP is the
internet-facing address, not the router's private LAN address. Devices on the
same Wi-Fi normally share the same public IP, configuration, and signal-rate
limit; IP binding cannot distinguish them. The dashboard stores keys encrypted
in Upstash Redis for up to 90 days since the last settings save. Market data is
not persisted. A per-public-IP status summary (signal count, latest
signal/error, EA heartbeat, and execution result) is stored until 90 days after
its latest update; it contains no broker account number or position details.
Anthropic processes each request and charges the key owner directly. Devices
on the same Wi-Fi can use the saved bridge and may incur API charges. Dynamic
IP changes, VPNs, and changing Wi-Fi can prevent access; create a different
Anthropic key for a different public IP. Users may select
`InpUseHostedService = false` to use the optional local bridge instead.

## Project contents

- `website/` — public landing page and downloadable EA package.
- `ClaudeAI_Scalper.mq5` and `ClaudeAI_Scalper.ex5` — MT5 Expert Advisor source
  and compiled program.
- `api/` — hosted settings, health, and Claude signal endpoints.
- `hosted_config.js` — encrypted per-IP settings storage and rate limiting.
- `localhost_bridge.js` — optional private loopback-only bridge; also exports the
  shared signal analysis used by the hosted endpoint.
- `Start_Local_Dashboard.bat` — starts the local bridge dashboard.
