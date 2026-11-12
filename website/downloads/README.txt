REM'Z AI TRADING POWERED BY CLAUDE
MT5 EXPERT ADVISOR DOWNLOAD

FILES
- ClaudeAI_Scalper.ex5       Compiled MT5 Expert Advisor
- ClaudeAI_Scalper.mq5       EA source code

REQUIREMENTS
- Windows computer
- MetaTrader 5 and a broker account
- A running compatible Rem'z AI Trading bridge
- Your own Anthropic API key and API billing account

INSTALLATION
1. In MT5, choose File > Open Data Folder.
2. Copy ClaudeAI_Scalper.ex5 and ClaudeAI_Scalper.mq5 into:
   MQL5\Experts\ClaudeAI_Scalper\
   Create the ClaudeAI_Scalper folder if needed.
3. This EA build requests its signal from http://127.0.0.1:8765. A compatible
   bridge must be running on the SAME computer as MT5.
4. In MT5, open Tools > Options > Expert Advisors and allow WebRequest for:
   http://127.0.0.1:8765
5. In Navigator, right-click Expert Advisors > Refresh. Attach the EA to an
   M5 chart and enable Algo Trading. Check the MT5 Experts and Journal tabs.

PRIVACY AND SECURITY
- The temporary bridge website is local-only and is not yet hosted for other
  users. A remotely hosted bridge will require an updated EA endpoint and
  per-user authentication and key isolation before public release.
- Never expose a local bridge to the public internet.
- Never share your API key, broker password, or account credentials.

TRADING RISK
This is experimental software, not financial advice and not a promise of
profit. AI signals can be wrong, orders can fail, and losses can exceed
expectations due to slippage, gaps, spread, commissions, or platform/broker
conditions. Each trade is submitted with Claude-derived broker-side SL/TP;
at the user's request, the EA maps Claude's SL distance to MT5 TP and Claude's
TP distance to MT5 SL, with no 100-point deduction. This intentionally reverses
the normal exit mapping and can create poor risk/reward. Check that the mapped
levels were accepted and appear on the open MT5 position.
There is no fixed $2/account-currency floating P/L auto-close. A broker-side
SL can still slip or be affected by gaps. Test on a demo account first. Use
live trading only if you understand and accept the risks.

Anthropic, Claude, MetaQuotes, MetaTrader 5, and broker names are trademarks
of their respective owners. This independent project is not endorsed by them.
