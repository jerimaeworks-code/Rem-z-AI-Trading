# Rem'z AI Trading Powered by Claude

The public website, hosted Claude signal API, and MT5 Expert Advisor are included
in this repository. Trades execute locally in each user's own MT5 terminal.

## Deploy the website to Vercel

Import this GitHub repository into Vercel and set the project **Root Directory**
to the repository root (`.`). The root [`vercel.json`](vercel.json) routes the
homepage, dashboard, animation script, and EA downloads from `website/`.
`api/health.js` and `api/signal.js` provide the hosted API. No build command or
database is required. The signal function is configured for a 60-second
maximum duration to allow the optional one-time HOLD retry. Deploy the `main`
branch.

## Use the hosted signal service

1. In MT5, allow `https://remzaitrading.vercel.app` under **Tools → Options →
   Expert Advisors → Allow WebRequest for listed URL**.
2. Attach the Expert Advisor to an M5 chart. Keep `InpUseHostedService` enabled,
   set `InpLotSize`, and enter your own Anthropic key in `InpAnthropicApiKey`.
3. Keep your broker login exclusively in your own MT5 terminal. The hosted
   service receives market-analysis data and a signal request only; it does not
   receive credentials or execute orders.

The EA sends the Anthropic key in an HTTPS request header for each analysis.
The application does not persist API keys, market requests, or per-user trading
status. Anthropic processes each request and charges the key owner directly.
Without accounts or a database, the dashboard is public service/setup status,
not a per-user settings or trade-monitoring dashboard. Users may still select
`InpUseHostedService = false` to use the optional local bridge instead.

## Project contents

- `website/` — public landing page and downloadable EA package.
- `ClaudeAI_Scalper.mq5` and `ClaudeAI_Scalper.ex5` — MT5 Expert Advisor source
  and compiled program.
- `api/` — public health endpoint and stateless hosted Claude signal endpoint.
- `localhost_bridge.js` — optional private loopback-only bridge; also exports the
  shared signal analysis used by the hosted endpoint.
- `Start_Local_Dashboard.bat` — starts the local bridge dashboard.
