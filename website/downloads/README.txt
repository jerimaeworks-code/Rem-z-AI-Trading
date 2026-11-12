REM'Z AI TRADING POWERED BY CLAUDE
MT5 EXPERT ADVISOR DOWNLOAD

FILES
- ClaudeAI_Scalper.ex5       Compiled MT5 Expert Advisor
- ClaudeAI_Scalper.mq5       EA source code

REQUIREMENTS
- Windows computer
- MetaTrader 5 and a broker account
- Your own Anthropic API key and API billing account
- Internet access to https://remzaitrading.vercel.app

HOSTED SERVICE INSTALLATION
1. In MT5, choose File > Open Data Folder.
2. Copy ClaudeAI_Scalper.ex5 and ClaudeAI_Scalper.mq5 into:
   MQL5\Experts\ClaudeAI_Scalper\
   Create the ClaudeAI_Scalper folder if needed.
3. In MT5, open Tools > Options > Expert Advisors, enable WebRequest for
   listed URL, and add:
   https://remzaitrading.vercel.app
4. Open https://remzaitrading.vercel.app/dashboard over the same Wi-Fi as MT5.
   Enter your own Anthropic API key, choose the lot size, and save settings.
   The first public IP to save an API key claims it. A claimed key cannot be
   used from a different public IP.
5. In Navigator, right-click Expert Advisors > Refresh. Attach the EA to an
   M5 chart and keep InpUseHostedService enabled.
   The EA retrieves the saved lot size and model from the hosted bridge.
6. Sign in to your broker account only in your own MT5 terminal. Enable Algo
   Trading only after reviewing all EA inputs.
7. Check the MT5 Experts and Journal tabs for service or broker errors.

PRIVACY AND SECURITY
- No website account is required. API keys are encrypted in Upstash Redis and
  expire after 90 days without a settings save. Market requests and per-user
  trading status are not persisted.
- Anthropic processes the analysis and bills the API-key owner.
- The hosted service returns signals only. The EA checks positions and places
  orders inside your own MT5 terminal.
- Devices on the same Wi-Fi usually share one public IP and one settings slot.
- Anyone on that Wi-Fi can use the configured bridge and may incur Anthropic
  charges; IP binding cannot distinguish people on the same network.
- Changing Wi-Fi, VPN, ISP, or public IP can disconnect settings. Use a
  different Anthropic API key for a different public IP.
- This website never asks for or receives your broker password or account
  credentials. Never share your Anthropic API key or publish it in source code.

OPTIONAL LOCAL BRIDGE
Set InpUseHostedService to false to use localhost_bridge.js instead. Run
Start_Local_Dashboard.bat and add http://127.0.0.1:8765 to MT5's WebRequest
allow list. The local bridge has separate local settings and is not needed for
the hosted service.

HOSTED STORAGE REQUIREMENT
The site owner must connect an Upstash Redis database and set
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, and a private
CONFIG_ENCRYPTION_KEY in Vercel's environment settings. Without these server
settings, the hosted dashboard cannot save API keys or lot sizes.

TRADING RISK
This is experimental software, not financial advice and not a promise of
profit. AI signals can be wrong, orders can fail, and losses can exceed
expectations due to slippage, gaps, spread, commissions, or platform/broker
conditions. Each trade is submitted with Claude-derived broker-side SL/TP;
at the user's request, the EA maps Claude's SL distance to MT5 TP and Claude's
TP distance to MT5 SL. This intentionally reverses normal exit mapping and can
create poor risk/reward. Check that mapped levels were accepted and appear on
the open MT5 position.
There is no fixed $2/account-currency floating P/L auto-close. Broker-side SL
can still slip or be affected by gaps. Test on a demo account first. Use live
trading only if you understand and accept the risks.

Anthropic, Claude, MetaQuotes, MetaTrader 5, and broker names are trademarks
of their respective owners. This independent project is not endorsed by them.
