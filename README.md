# Rem'z AI Trading Powered by Claude

The public website is in [`website/`](website/). The MT5 Expert Advisor and
local Claude bridge are included in this repository for download and setup.

## Deploy the website to Vercel

Import this GitHub repository into Vercel and set the project **Root Directory**
to the repository root (`.`). The root [`vercel.json`](vercel.json) routes the
homepage, animation script, and EA downloads from `website/`. No build command
is required for this static site. Deploy the `main` branch.

The dashboard link opens `http://127.0.0.1:8765/dashboard` on the visitor's
own computer. Each visitor must run their own local bridge; deploying the static
website does not host or share the bridge or Anthropic API key.

## Project contents

- `website/` — public landing page and downloadable EA package.
- `ClaudeAI_Scalper.mq5` and `ClaudeAI_Scalper.ex5` — MT5 Expert Advisor source
  and compiled program.
- `localhost_bridge.js` — private loopback-only Claude/MT5 bridge.
- `Start_Local_Dashboard.bat` — starts the local bridge dashboard.
