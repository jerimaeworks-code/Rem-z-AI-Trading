"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 8765;
const WEBSITE_ROOT = path.join(__dirname, "website");
const WEBSITE_MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".zip", "application/zip"],
]);
const ALLOWED_ORIGINS = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MARKET_DATA_CHARS = 48_000;
const DEFAULT_MODEL = "claude-sonnet-5-5";
const EXIT_MAPPING_GUIDANCE = "\nEXIT MAPPING OVERRIDE: The EA intentionally swaps Claude's two returned exit distances when it places an order. Keep the standard output tokens BUY/SELL confidence stop_loss_points take_profit_points, but the EA uses stop_loss_points as the MT5 take-profit distance and take_profit_points as the MT5 stop-loss distance, with no 100-point deduction. Both mapped distances must fit the EA's configured broker-side limits: active SL 100-2000 points and active TP 100-3000 points, so return both Claude distances within 100-2000 points (the bridge requires its take_profit_points token to be at least 200). Do not reverse BUY/SELL direction. This deliberate reversal may create poor risk/reward and does not guarantee a profitable exit.";
const CANDLESTICK_GUIDANCE = "Use supplied CLOSED M5 OHLC bars, measured candle geometry, prior trend, nearby support/resistance, and tick-volume context to classify evidence as bullish, bearish, or neutral. For every bar calculate body=abs(close-open), upper shadow=high-max(open,close), lower shadow=min(open,close)-low, and full range=high-low; the diagram shapes are schematic, not data. Approximate screening heuristics (not universal laws): Hammer has a small real body near the range high, lower shadow at least 2x body and little upper shadow, and is bullish only after a decline; Hanging Man has the same shape after a rise and is bearish only with bearish follow-through. Inverted Hammer has a small body near the range low, upper shadow at least 2x body and little lower shadow after a decline; it is only a potential bullish reversal until follow-through. Shooting Star has the same geometry after a rise and is only a potential bearish reversal until follow-through. Dragonfly Doji has open/close near the high, negligible body and long lower shadow; it is a bullish candidate only in context. Gravestone Doji has open/close near the low, negligible body and long upper shadow; it is a bearish candidate only in context. Standard Doji has open/close nearly equal and is neutral/indecision alone; Long-Legged Doji has very long shadows on both sides and remains neutral absent directional follow-through. Marubozu has a long directional body with very small shadows: close>open is Bullish Marubozu, close<open is Bearish Marubozu; do not infer its direction from shape alone. Spinning Top has a small body and meaningful upper/lower shadows, indicating indecision, not a standalone directional signal. Assess ratios relative to the candle's range and instrument precision; if proportions are marginal, label it a candidate rather than confirmed. Also assess Bullish/Bearish Engulfing, Piercing Line/Dark Cloud Cover, Tweezer Bottom/Top, Morning/Evening Star, and Three White Soldiers/Black Crows from the complete required candle sequences and close locations, not names alone. For each candidate verify actual OHLC proportions, required sequence, prior trend, and location relative to supplied support/resistance. A reversal pattern becomes confirmed directional evidence only with suitable subsequent CLOSED-candle follow-through (for example, a close in the expected direction or through its trigger); otherwise label it forming/unconfirmed and reduce or omit its directional weight. Relative tick-volume expansion/contraction is supporting context only; MT5 tick volume is not exchange-wide traded volume and cannot independently confirm a move. Do not assume gaps unless shown by supplied prices. These pattern checks classify candle evidence; they do not require all indicators to agree or form a standalone entry gate. Other measurable M5 evidence may still support a low-confidence direction if stop and target are defensible. Do not invent chart visuals, volume data, or missing values.";
const CHART_PATTERN_GUIDANCE = "Chart-pattern recognition is required only when objectively supported by the supplied closed OHLC sequence. Analyze up to 120 M5 candles for reversal patterns: Head and Shoulders, Inverse Head and Shoulders, Double/Triple Top and Bottom, Rounding Top/Bottom, V-shaped and Inverted-V reversals, Adam/Eve Top and Bottom, Diamond Top/Bottom, Broadening Top/Bottom, Failed Breakout/Breakdown, Bull Trap/Bear Trap. Analyze continuation patterns: Bull/Bear Flags and Pennants, Ascending/Descending/Symmetrical Triangles, Rising/Falling/Horizontal Channels, Rectangle Consolidation, Rising/Falling Wedges, Cup and Handle/Inverse Cup and Handle, Measured Moves, Consolidation Breakouts, Trendline Breaks/Retests, Range Breakouts/Retests, Pullback Continuation, Inside-Bar Breakouts, Volatility Contraction Breakouts. Also assess Contracting/Expanding Triangles, Expanding Wedges, Triangle Fakeouts, Breakout/Breakdown Retests, False Breakouts/Breakdowns, Support/Resistance Breaks, and Break-and-Retest formations. Check harmonic candidates Gartley, Butterfly, Bat, Crab/Deep Crab, Shark, Cypher, ABCD, and Three Drives only if clear pivot points and required Fibonacci ratios are measurable; otherwise mark unverified. Evaluate market structure: BOS, CHOCH, MSS, HH/HL, LH/LL, liquidity sweeps, equal highs/lows, stop-run reversals, supply/demand, support/resistance, order-block candidates, FVGs/imbalances, breaker/mitigation blocks, S/R flips, Wyckoff accumulation/distribution, Spring and Upthrust. These are price-action interpretations, not proof of institutional activity. For each candidate, internally assess direction, relevant boundary/neckline, state (forming, confirmed, invalidated, or unverified), required close/retest, invalidation, and realistic measured target. A wick through a boundary is not a confirmed breakout; require a closed candle beyond the trigger when appropriate. Use repeated, objectively identifiable swing reactions, not an imagined pattern. Do not force labels: say unsupported/unverified when the candle history is too short, ambiguous, or lacks pivots. Patterns and indicators derived from the same candles are correlated evidence, not independent votes. M5 remains the only entry timeframe; higher timeframes are supporting context only.";
const CHART_ILLUSTRATION_GUIDANCE = "Interpret the user's schematic chart examples against measured swing pivots in the supplied CLOSED M5 OHLC sequence; the sketches are conceptual and are not themselves evidence. Bullish Ascending Triangle: repeated near-flat resistance with rising swing lows; it is only a breakout after a candle closes above resistance. Bullish Falling Wedge: both boundaries slope down and converge, with lower highs/lows; bullish breakout requires a close above the upper boundary. Bullish Cup and Handle: a broad rounded U-shaped recovery toward a prior rim followed by a smaller handle pullback; pattern completes on a closed break above the rim/handle resistance. Bullish Double Bottom: two distinct lows near the same support separated by an intervening rebound; confirmation requires a close above that middle peak/neckline. Bullish Flag: a sharp upward flagpole followed by a relatively short, narrow consolidation/slight downward drift; confirmation requires a close above the flag boundary. Bearish Descending Triangle: repeated near-flat support with descending highs; breakdown requires a close below support. Bearish Rising Wedge: converging upward-sloping boundaries with higher highs and lows; bearish confirmation requires a close below the lower boundary. Bearish Head and Shoulders: three peaks with a higher middle head and plausible neckline through the intervening troughs; breakdown requires a close below the neckline. Bearish Double Top: two distinct highs near resistance separated by an intervening trough; confirmation requires a close below that trough/neckline. Bearish Flag: a sharp downward flagpole followed by a relatively short, narrow consolidation/slight upward drift; confirmation requires a close below the flag boundary. Symmetrical Triangle: converging lower highs and higher lows; direction is neutral until a closed breakout, so do not predict direction from the triangle alone. For each, verify actual pivots, repeated reactions, pattern proportions/sequence, and nearby context; label forming, confirmed by a closed boundary break, invalidated, or unsupported. A wick/touch is not a breakout, and a retest is confirmed only when shown in the supplied candles. Do not assign arbitrary boundaries or measured targets where the OHLC data does not support them. Pattern detection is analytical context, not a mandatory extra entry confirmation.";

const BOLLINGER_STRATEGY_GUIDANCE = "MANDATORY ENTRY PLAYBOOK: Use the EA-supplied Bollinger Bands (M5 SMA20, 2 standard deviations), normalized 5-bar middle-band slope/state, latest CLOSED M5 OHLC, current bands, 20-prior-bar bandwidth test, candle body fraction, tick-volume comparison, and repeated M5 pivot support/resistance. The playbook determines entry eligibility: issue a BUY/SELL only when an allowed setup is present and defensible SL/TP distances exist. In an uptrend, never SELL; issue BUY only after the closed signal candle reaches within 0.30 ATR of support with at least two pivot reactions clustered within the EA's 0.15 ATR (minimum 5 points) tolerance, and a bullish rejection/engulfing candle closes back above support. In a downtrend, never BUY; issue SELL only after the closed signal candle reaches within 0.30 ATR of resistance with at least two pivot reactions clustered within the same tolerance, and a bearish rejection/engulfing candle closes back below resistance. Do not predict a future touch; require actual closed-candle rejection. In flat_range, a BUY may qualify at repeatedly tested support with bullish close-back-above rejection, or a SELL at repeatedly tested resistance with bearish close-back-below rejection, using the same pivot count and distance rules. Flat range may also qualify on lower-band touch/pierce followed by close back inside for BUY, or upper-band touch/pierce followed by close back inside for SELL; avoid mid-band entries. Use the middle band as the range first-profit reference. The active EA TP is Claude's TP minus 100 points, using the full remaining distance; do not claim it will hit the middle band unless that target aligns with the measured level. A squeeze breakout is eligible only in flat_range when current bandwidth is the lowest of the 20 prior closed bars, the latest candle closes beyond the corresponding outer band with body fraction >= 0.60, and tick volume exceeds the preceding-five-bar average. Do not allow a squeeze or other setup to reverse the BB trend direction. No wick-only breakout. The local EA enforces the same gate after Claude's response, so match its criteria exactly; a BUY/SELL passing it proceeds to normal risk and broker validation. Use only supplied values. If no playbook entry is present, return HOLD.";
const SUPPORT_RESISTANCE_ENTRY_GUIDANCE = "For strong trend-aligned level entries, evaluate the supplied repeated M5 pivot support/resistance and closed-candle evidence exactly as specified by the mandatory Bollinger entry playbook. The EA independently verifies that same setup before execution. Return a BUY/SELL only when the matching direction, tested level, rejection candle, and risk levels all qualify; otherwise return HOLD.";
const SUPPORT_RESISTANCE_CONSOLIDATION_GUIDANCE = "\nSUPPORT/RESISTANCE CONSOLIDATION AND RETEST PLAYBOOK (M5): Inspect the recent CLOSED candles for a compact base/consolidation whose lows repeatedly hold a measured support pivot, or a pullback/retest whose highs repeatedly fail at a measured resistance pivot or objectively supported descending trendline. Determine whether candles overlap and compress relative to their recent ranges/ATR; do not label a single pause or an untested price as a level. At support, a held base plus downside rejection/failed breakdown and a bullish closed-candle response (close back above support or break above the compact base) is a BUY setup; favor BUY rather than HOLD when these observable conditions are present, including a bounce within a broader downtrend if the nearby evidence supports it. At resistance, a retest/failure to break above plus upper-wick rejection or a bearish closed-candle response (close back below resistance/base) is a SELL setup; favor SELL rather than HOLD when those conditions are present. Apply the reverse logic at the opposite boundary: bullish rejection at resistance does not automatically mean BUY; require a genuine close/break through it, and bearish rejection at support does not automatically mean SELL; require a genuine close/break below it. A clear closed break through a level followed by a retest that holds on the other side can instead support continuation in the breakout direction. Do not enter from consolidation in the middle of a range, invent trendlines, or treat a touch alone as confirmation. Use the measured pivot distances/touch counts, actual OHLC sequence, candle close/wicks, ATR, and executable quote. For a qualified support/resistance base or retest, select the direction and defensible SL/TP; uncertainty can lower confidence but must not force HOLD. If the level or response is not objectively supported, use other supplied M5 evidence rather than inventing the setup.";
const STRUCTURE_BASED_RISK_GUIDANCE = "\nSTRUCTURE-BASED STOP AND TARGET PLAN (M5): First choose the entry direction/setup, then anchor risk to actual price structure, not an arbitrary fixed distance. For BUY, put the SL below the most relevant confirmed recent swing low/support/base that invalidates the setup; for SELL, put it above the confirmed swing high/resistance/retest high. Add a modest volatility-aware buffer beyond that structure using ATR14 and spread, rather than placing the stop directly on the pivot. Check the whole supplied OHLC sequence and measured M5/M15/M30/H1 pivots; do not invent swing points or use an unconfirmed wick as a major level. Then calculate risk R as the entry-to-structural-SL distance in points from ASK for BUY or BID for SELL. Compare three TP candidates: (1) just before the nearest meaningful opposing support/resistance zone, with a buffer so the target is not inside the zone; (2) 2R from entry; (3) just before the next major opposing support/resistance zone, identified by clear swing reactions/touches and higher-timeframe context when supplied. Select one target: prefer a clear reachable structural target, do not set a target beyond an intervening opposing level, and use 2R when structure leaves room for it. Never stretch a target through resistance/support merely to force 2R; avoid a structurally blocked target or one with clearly inadequate reward relative to risk. Calculate all distances from the current executable quote and label direction correctly. IMPORTANT: the EA subtracts 100 MT5 points from the TP distance you return; therefore return the chosen desired active-target distance PLUS 100 points. Final active TP must remain 100-3000 points (Claude's output 200-3100). Keep SL 100-2000 points. If structure-based SL/TP cannot fit those limits or broker constraints without misrepresenting the chart, do not fabricate levels; return HOLD. The EA retains its broker-side protective SL.";
const STRUCTURE_PATTERN_EXIT_GUIDANCE = "\nSTRUCTURE AND SETUP-SPECIFIC EXIT CHECKS: Determine trend from actual swing sequence: HH/HL supports bullish structure; LH/LL supports bearish structure. For a pullback entry, anchor the protective SL beyond the relevant confirmed HL (BUY) or LH (SELL); use the pattern/swing extreme that truly invalidates the setup, not an arbitrary nearby candle. At a support-bounce BUY, place SL beyond the support zone/recent swing low and target before the next resistance; at a resistance-rejection SELL, place SL beyond resistance/recent swing high and target before the next support. Do not rely on one candle shape alone: judge it with preceding trend, location at measured support/resistance, and closed-candle confirmation. For confirmed engulfing, hammer/shooting-star, or multi-candle reversal setups, use the whole pattern extreme for invalidation and the next opposing level for the structural target. For a double top/bottom or head-and-shoulders variant, only use a measured neckline break as confirmation; the pattern extreme/shoulder or invalidation swing informs SL, while the measured head-to-neckline projection is only an additional TP candidate, capped before intervening opposing structure. For a flag, use the flag boundary for invalidation and the flagpole projection only as a candidate target, likewise capped at the next opposing zone. For a breakout-and-retest, require the closed break and a shown retest/response; put SL beyond the retest swing or broken level on the invalidation side, and TP before the next opposing level or at a feasible measured move. For a liquidity sweep, require price to sweep a visible prior high/low and close back across it with directional follow-through; put SL beyond the sweep extreme and target the next opposing swing/zone. A sweep alone is not reversal proof. Identify only patterns and levels supported by supplied OHLC; do not invent necklines, projections, zones, or confirmation. These setup-specific levels refine the general structural SL and three-target comparison; they do not override the 2R, reachable-target, TP adjustment, or EA distance limits.";
const QUALITY_FIRST_GUIDANCE = "\nFORCED-DIRECTION M5 DECISION: The EA requests one prediction per new closed M5 candle when the account is flat. Always choose BUY or SELL; HOLD is not an allowed decision. Use the strongest available closed-M5 directional evidence, even when confidence is low. If evidence conflicts, weigh candle close/location, recent swing direction, trend, momentum, and nearby support/resistance; do not claim certainty. Select a protective SL beyond the nearest observable invalidation swing with a modest ATR/spread-aware buffer and choose a reachable target before opposing structure, using observable candle extremes and ATR conservatively if a clear pivot is unavailable. Respect the required SL/TP ranges and never omit the protective SL. A forced directional signal can lose and remains subject to account, one-position, spread, optional daily drawdown, margin, and broker checks. Keep the existing output format and point ranges exactly.";
const QUALITY_FIRST_PRECEDENCE = " FORCED-DIRECTION PRECEDENCE: This instruction overrides any earlier wording that offers HOLD or recommends skipping a weak setup. Never output HOLD; choose the better-supported direction and lower confidence when evidence is weak.";
const FORCED_DIRECTION_RETRY = "\nFINAL RETRY INSTRUCTION: Your previous answer was HOLD, which is not an allowed output. Reassess the supplied closed M5 data and choose BUY or SELL, even if the setup is weak or uncertain. Use the latest closed candle, recent swing direction, EMA/momentum context, and nearest observable support/resistance to break ties. Return valid structural stop and target distances within the stated ranges. Do not return HOLD, an explanation, or any extra text.";

const SIGNAL_SYSTEM_PROMPT = `You are a disciplined M5 gold-trading analyst. Use the supplied CLOSED M5 candle history, measured indicator values, executable quotes, and stated support/resistance and higher-timeframe context. Analyze the complete evidence rather than counting a fixed number of confirmations.

For each opportunity, assess trend and swing structure; EMA20/50/200; RSI14 and any supplied divergence; MACD/signal; momentum; ATR; tick-volume VWAP; Bollinger bands and squeeze; Stochastic; ADX/+DI/-DI; Fibonacci context; nearby pivot support/resistance; and the supplied candle geometry/OHLC history. Explicitly apply the support/resistance consolidation-and-retest playbook supplied below: at a measured support base, a bullish closed-candle rejection/response favors BUY; at a measured resistance retest, a bearish closed-candle rejection/response favors SELL; a confirmed break/retest favors continuation. Treat this as a first-class M5 setup, not something to ignore when other indicators conflict. For each candlestick candidate, state its bullish, bearish, or neutral implication and whether it is confirmed on closed candles, invalidated, or unsupported. Give reversal candles more weight at relevant support/resistance and only after suitable follow-through; use relative tick-volume context cautiously because it is not exchange-wide volume. Consider higher timeframes only as context; M5 remains the entry timeframe. Patterns, indicators, pivots, VWAP, and Fibonacci are estimates, not guarantees or proof of institutional activity. Do not invent missing data, prices, patterns, news, or sentiment; treat unsupported patterns and unavailable measurements as unknown.

Do not require a fixed confirmation count, confirmation mask, named chart pattern, or agreement from multiple indicators/timeframes. Select BUY or SELL only when the available M5 evidence supports a timely setup with defensible risk levels; when evidence is weak, late, blocked, or mixed, return HOLD rather than manufacture a directional trade. Bollinger Bands and support/resistance are evidence, not mandatory entry gates. Do not invent measurements, prices, or trades, and do not claim perfect entries or guaranteed profits. A wick through a breakout level alone is not a confirmed breakout.

For any BUY/SELL, derive SL beyond the relevant confirmed swing/pivot that invalidates the setup, with a modest ATR/spread-aware buffer, not directly on the level. Compare TP1 just before the nearest meaningful opposing support/resistance, TP2 at 2R, and TP3 just before the next major opposing support/resistance; choose one realistic, unblocked target, preferring clear structure and using 2R when there is room. Do not force 2R through an intervening level. Calculate R and target distances in MT5 points from the current executable quote (ASK for BUY or BID for SELL). The EA subtracts 100 points from the Claude TP distance, so add 100 points to the chosen desired active TP distance in your output; the resulting active TP must be 100-3000 points and SL 100-2000 points. The EA retains a broker-side protective SL. Preserve broker execution checks; daily drawdown protection and per-trade risk-cap enforcement are optional EA inputs and may be disabled.

Use all supplied candle and market evidence. Prefer an actionable signal only when a timely setup and defensible structural SL/TP exist; if indicators conflict, price is extended, opposing structure blocks the target, or reward is inadequate, return HOLD rather than force an entry. Return exactly four space-separated tokens and nothing else: BUY confidence stop_loss_points take_profit_points, SELL confidence stop_loss_points take_profit_points, or HOLD 0 0 0. Confidence is 0-100. BUY/SELL SL must be 100-2000 points and Claude's TP must be 200-3100 points; the EA subtracts 100 points to set an active TP of 100-3000 points. Never omit protective SL. No markdown or explanation.`;
const MULTI_TIMEFRAME_GUIDANCE = " The request may also contain closed M15, M30, and H1 candle/indicator context. Compare these higher timeframes for broader trend, momentum, and nearby structure; describe agreement or conflict only from supplied values. They are supporting context, not separate execution signals. M5 remains the sole entry timeframe: base the direction on the available M5 setup and do not trigger an entry solely because higher timeframes align. Do not reject a plausible M5 entry merely because a higher-timeframe indicator is unavailable. Never invent missing higher-timeframe values.";

let apiKey = process.env.ANTHROPIC_API_KEY || "";
let model = DEFAULT_MODEL;
let requestCount = 0;
let lastRequestAt = null;
let lastSignal = "No signal requests yet";
let lastError = "";
let lastExecutionStatus = "No execution result reported yet";
let lastExecutionAt = null;
let lastHeartbeatAt = null;
let eaSymbol = "";
let eaTimeframe = "";
let eaVersion = "";
let eaTradingEnabled = false;
let lotSize = 0.01;

const dashboard = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Claude MT5 Local Bridge</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-synthesis: none; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; overflow-x: hidden; background: radial-gradient(ellipse at 8% 0%, #142957 0, transparent 38%), radial-gradient(ellipse at 100% 32%, #302153 0, transparent 33%), #080d19; color: #edf3ff; }
    body::before, body::after { position: fixed; z-index: -1; width: 330px; height: 330px; border-radius: 50%; content: ""; filter: blur(90px); opacity: .2; pointer-events: none; animation: drift 15s ease-in-out infinite alternate; }
    body::before { top: 18%; left: -180px; background: #2be0bd; }
    body::after { right: -190px; bottom: 8%; background: #9872ff; animation-delay: -7s; }
    main { width: min(920px, calc(100% - 36px)); margin: 42px auto 72px; }
    header, section { position: relative; overflow: hidden; background: linear-gradient(145deg, rgb(19 29 51 / 94%), rgb(13 20 37 / 94%)); border: 1px solid rgb(145 171 218 / 15%); border-radius: 22px; padding: 25px; box-shadow: 0 18px 54px rgb(0 0 0 / 22%); backdrop-filter: blur(14px); animation: rise .65s both; }
    header { margin-bottom: 18px; padding: clamp(25px, 6vw, 48px); }
    header::after { position: absolute; top: -85px; right: -35px; width: 260px; height: 260px; border: 1px solid rgb(65 228 201 / 16%); border-radius: 50%; box-shadow: 0 0 0 26px rgb(65 228 201 / 3%), 0 0 0 54px rgb(65 228 201 / 2%); content: ""; }
    section { margin-top: 16px; }
    section:nth-of-type(2) { animation-delay: .06s; }
    section:nth-of-type(3) { animation-delay: .12s; }
    section:nth-of-type(4) { animation-delay: .18s; }
    section:nth-of-type(5) { animation-delay: .24s; }
    h1 { margin: 14px 0 8px; font-size: clamp(32px, 6vw, 52px); letter-spacing: -.045em; line-height: 1.05; }
    h2 { margin: 0 0 12px; font-size: 19px; letter-spacing: -.02em; }
    p { color: #aab8d1; line-height: 1.65; }
    .eyebrow { color: #78e8d2; font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
    .hero-copy { max-width: 620px; margin-bottom: 0; }
    .pill { display: inline-flex; align-items: center; gap: 9px; padding: 8px 12px; border: 1px solid rgb(139 164 207 / 16%); border-radius: 999px; background: rgb(20 33 57 / 82%); color: #d4def0; font-size: 13px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #ffbe5c; box-shadow: 0 0 12px currentColor; }
    .dot.ready { background: #47e0b7; color: #47e0b7; animation: pulse 1.8s infinite; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .grid section { margin-top: 16px; }
    .wide { grid-column: 1 / -1; }
    label { display: block; margin: 15px 0 7px; color: #c6d1e6; font-size: 13px; font-weight: 650; }
    input { width: 100%; min-height: 46px; padding: 11px 13px; border: 1px solid #354665; border-radius: 11px; outline: none; background: rgb(7 13 26 / 88%); color: #f4f7ff; font: inherit; transition: border-color .2s, box-shadow .2s, transform .2s; }
    input:focus { border-color: #68dccb; box-shadow: 0 0 0 3px rgb(62 220 192 / 14%); }
    input[type="number"] { font-size: 19px; font-variant-numeric: tabular-nums; }
    button, .button-link { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; margin-top: 17px; border: 0; border-radius: 11px; padding: 11px 17px; background: linear-gradient(110deg, #52e2c0, #81efd2); color: #08221f; font: inherit; font-weight: 800; text-decoration: none; cursor: pointer; box-shadow: 0 7px 24px rgb(58 222 190 / 16%); transition: transform .2s, box-shadow .2s, filter .2s; }
    button:hover, .button-link:hover { transform: translateY(-2px); box-shadow: 0 11px 30px rgb(58 222 190 / 25%); filter: brightness(1.06); }
    button:active, .button-link:active { transform: translateY(0); }
    .button-link { margin-top: 0; }
    .muted { margin: 8px 0 0; color: #8798b4; font-size: 12px; }
    .lot-readout { display: inline-flex; align-items: center; gap: 8px; margin-top: 5px; color: #74e7cf; font-size: 12px; font-weight: 750; }
    dl { display: grid; grid-template-columns: minmax(130px, 190px) 1fr; gap: 13px 16px; margin: 0; }
    dt { color: #8fa1bd; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .notice { padding: 13px 15px; border: 1px solid rgb(255 190 92 / 22%); border-left: 3px solid #ffbe5c; background: rgb(255 190 92 / 6%); border-radius: 10px; }
    .message { min-height: 20px; margin: 10px 0 0; font-size: 13px; }
    code { color: #87ead7; }
    #last-error:not(:empty) { color: #ff9a9a; }
    @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulse { 50% { opacity: .55; box-shadow: 0 0 3px currentColor; } }
    @keyframes drift { to { transform: translate(45px, -35px) scale(1.13); } }
    @media (max-width: 680px) { main { margin: 20px auto 42px; } .grid { grid-template-columns: 1fr; gap: 0; } .wide { grid-column: auto; } header, section { border-radius: 17px; padding: 20px; } dl { grid-template-columns: 1fr; gap: 5px; } dd { margin-bottom: 10px; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="pill"><span class="dot" id="health-dot"></span><span id="health">Checking local bridge…</span></div>
      <p class="eyebrow">Your trading workspace</p>
      <h1>Claude MT5 Bridge</h1>
      <p class="hero-copy">AI market analysis, MT5 execution, and your trade size settings in one place. This dashboard and bridge listen only on this computer.</p>
      <p><a class="button-link" href="/">← Back to Rem'z AI Trading home</a></p>
    </header>
    <div class="grid">
    <section>
      <p class="eyebrow">Position control</p>
      <h2>Lot size per trade</h2>
      <p>Choose the volume the EA should request whenever it receives a valid BUY or SELL signal.</p>
      <form id="lot-form">
        <label for="lot-size">Trade volume (lots)</label>
        <input id="lot-size" type="number" min="0.01" max="100" step="0.01" value="0.01" required>
        <p class="muted">The EA adjusts the requested lot to the broker’s minimum, maximum, and step. Per-trade risk-cap enforcement is disabled by default; the EA still requires valid SL/TP, sufficient free margin, and compliance with daily drawdown and broker rules. A stop-out can exceed the optional 0.25% reference amount.</p>
        <button type="submit">Apply lot size</button>
      </form>
      <p class="lot-readout">● Active setting: <span id="active-lot">0.01 lots</span></p>
      <p id="lot-message" class="message" role="status"></p>
    </section>
    <section>
      <p class="eyebrow">AI setup</p>
      <h2>Claude connection</h2>
      <p>Your API key stays in bridge memory. It is never written to a settings file or shown after saving. Leave the key blank to keep it.</p>
      <form id="config-form">
        <label for="api-key">Anthropic API key</label>
        <input id="api-key" type="password" autocomplete="new-password" placeholder="Leave blank to keep the saved key">
        <label for="model">Claude model</label>
        <input id="model" value="claude-sonnet-5-5" maxlength="100" required>
        <button type="submit">Save Claude settings</button>
      </form>
      <p id="message" class="message" role="status"></p>
    </section>
    <section class="wide">
      <p class="eyebrow">Live system status</p>
      <h2>Bridge status</h2>
      <dl>
        <dt>Local address</dt><dd><code>http://127.0.0.1:8765</code></dd>
        <dt>API key</dt><dd id="key-status">Checking…</dd>
        <dt>Model</dt><dd id="current-model">—</dd>
        <dt>Claude signal requests</dt><dd id="request-count">0</dd>
        <dt>Last request</dt><dd id="last-request">None</dd>
        <dt>Latest signal</dt><dd id="last-signal">None</dd>
        <dt>Last execution result</dt><dd id="last-execution">Waiting for EA status</dd>
        <dt>Execution updated</dt><dd id="execution-time">None</dd>
        <dt>Latest API error</dt><dd id="last-error">None</dd>
        <dt>MT5 EA connection</dt><dd id="ea-status">Not connected</dd>
        <dt>EA last seen</dt><dd id="ea-last-seen">None</dd>
        <dt>EA chart</dt><dd id="ea-chart">None</dd>
        <dt>EA build</dt><dd id="ea-version">Unknown</dd>
        <dt>Order setting</dt><dd id="ea-trading">Unknown</dd>
      </dl>
    </section>
    <section>
      <h2>XM MT5 WebTrader</h2>
      <p>Sign in through XM’s official MT5 WebTrader. Your XM account password is entered on XM’s site, not in this dashboard.</p>
      <p><a class="button-link" href="https://mt5.xm.com" target="_blank" rel="noopener noreferrer">Open XM MT5 WebTrader</a></p>
    </section>
    <section>
      <h2>Connect MT5</h2>
      <p>In MT5, open <strong>Tools → Options → Expert Advisors</strong> and allow WebRequest for <code>http://127.0.0.1:8765</code>. Keep this bridge running, then attach the EA to an M5 chart.</p>
      <p class="notice">M5 is the entry timeframe. Claude is instructed to choose BUY or SELL for each new M5 candle when the account is flat; if it returns HOLD, the bridge retries once with a mandatory-direction instruction, which may incur an additional API charge. The EA still skips a signal if Claude's retry fails, the signal is invalid, an account position is open, or MT5/broker checks reject execution. The EA permits only one account position at a time. At the user's request, the EA maps Claude's SL distance to MT5 TP and Claude's TP distance to MT5 SL, with no 100-point deduction. This intentionally reverses the normal exit mapping and can produce poor risk/reward; verify both levels on the open MT5 position. Execution remains subject to spread, margin, account permission and broker rules; daily drawdown and per-trade risk caps are optional and disabled by default. Forced directional signals can be poor and do not guarantee a trade or profit; live trading risks real money.</p>
    </section>
    </div>
  </main>
  <script>
    const message = document.getElementById("message");
    async function refreshStatus() {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) throw new Error("Status request failed");
        const state = await response.json();
        document.getElementById("health").textContent = "Local bridge is running";
        document.getElementById("health-dot").classList.toggle("ready", state.configured);
        document.getElementById("key-status").textContent = state.configured ? "Configured (key hidden)" : "Not configured";
        document.getElementById("current-model").textContent = state.model;
        document.getElementById("request-count").textContent = String(state.request_count);
        document.getElementById("last-request").textContent = state.last_request_at || "None";
        document.getElementById("last-signal").textContent = state.last_signal;
        document.getElementById("last-execution").textContent = state.last_execution_status;
        document.getElementById("execution-time").textContent = state.last_execution_at || "None";
        document.getElementById("last-error").textContent = state.last_error || "None";
        if (document.activeElement !== document.getElementById("model")) {
          document.getElementById("model").value = state.model;
        }
        document.getElementById("ea-status").textContent = state.ea_connected ? "Connected" : "Not connected";
        document.getElementById("ea-last-seen").textContent = state.ea_last_seen_at || "None";
        document.getElementById("ea-chart").textContent = state.ea_symbol
          ? state.ea_symbol + " " + state.ea_timeframe : "None";
        document.getElementById("ea-version").textContent = state.ea_version || "Update needed";
        document.getElementById("ea-trading").textContent = state.ea_connected
          ? (state.ea_trading_enabled ? "Enabled in EA (demo and live permitted)" : "Signal-only; no orders")
          : "Unknown";
        document.getElementById("active-lot").textContent = Number(state.lot_size).toFixed(2) + " lots";
        if (document.activeElement !== document.getElementById("lot-size")) {
          document.getElementById("lot-size").value = Number(state.lot_size).toFixed(2);
        }
      } catch {
        document.getElementById("health").textContent = "Bridge status unavailable";
      }
    }
    document.getElementById("config-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      message.textContent = "Saving…";
      try {
        const response = await fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: document.getElementById("api-key").value,
            model: document.getElementById("model").value
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not save settings");
        document.getElementById("api-key").value = "";
        message.textContent = result.key_updated
          ? "API key saved in memory. It will be forgotten when the bridge stops."
          : "Model updated. The saved API key was kept.";
        await refreshStatus();
      } catch (error) {
        message.textContent = error.message;
      }
    });
    document.getElementById("lot-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const lotMessage = document.getElementById("lot-message");
      lotMessage.textContent = "Applying lot size…";
      try {
        const response = await fetch("/api/lot-size", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lot_size: Number(document.getElementById("lot-size").value) })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not apply lot size");
        lotMessage.textContent = "Requested " + Number(result.lot_size).toFixed(2) + " lots. The EA will adjust to broker volume rules and check available margin; it will report the actual volume and estimated stop-loss exposure.";
        await refreshStatus();
      } catch (error) {
        lotMessage.textContent = error.message;
      }
    });
    refreshStatus();
    setInterval(refreshStatus, 3000);
  </script>
</body>
</html>`;

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large"));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function extractSignalTextFromBlocks(content) {
  const blocks = Array.isArray(content) ? content : [];
  const segments = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      segments.push(block.text);
    } else if ((block.type === "thinking" || block.type === "reasoning") && typeof block.thinking === "string" && block.thinking.trim()) {
      segments.push(block.thinking);
    } else if (typeof block.text === "string" && block.text.trim()) {
      segments.push(block.text);
    }
  }
  return segments.join("\n");
}

function normalizeSignalText(text) {
  return text
    .replace(/```(?:\w+)?/g, "")
    .replace(/`/g, "")
    .replace(/^(?:decision|signal)\s*:\s*/i, "")
    .trim();
}

function extractSignalCandidate(text) {
  const cleaned = normalizeSignalText(text || "");
  if (!cleaned) return "";
  const exactMatches = [...cleaned.matchAll(/\b(?:BUY|SELL|HOLD)\s+\d{1,3}\s+\d{1,5}\s+\d{1,5}\b/gi)];
  if (exactMatches.length > 0) return exactMatches[0][0].trim();
  const singleLine = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of singleLine) {
    const match = /^(BUY|SELL|HOLD)\s+(\d{1,3})\s+(\d{1,5})\s+(\d{1,5})[.!]?$/i.exec(line);
    if (match) return `${match[1].toUpperCase()} ${match[2]} ${match[3]} ${match[4]}`;
  }
  return "";
}

class InvalidSignalError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidSignalError";
  }
}

function parseSignal(text) {
  const candidate = extractSignalCandidate(text);
  const match = /^(BUY|SELL|HOLD)\s+(\d{1,3})\s+(\d{1,5})\s+(\d{1,5})[.!]?$/i.exec(candidate);
  if (!match)
    throw new InvalidSignalError("Claude response did not contain exactly one valid signal row");

  const [, action, confidenceText, stopText, targetText] = match;
  const normalizedAction = action.toUpperCase();
  const confidence = Number(confidenceText);
  const stop = Number(stopText);
  const target = Number(targetText);
  if (confidence > 100 || stop > 2000 || target > 3100)
    throw new InvalidSignalError("Claude returned signal values outside bridge limits");
  if (normalizedAction === "HOLD") {
    if (confidence !== 0 || stop !== 0 || target !== 0)
      throw new InvalidSignalError("HOLD signal must be HOLD 0 0 0");
  } else if (confidence < 1 || stop < 100 || target < 200) {
    throw new InvalidSignalError("Trade signal requires valid confidence and risk distances");
  }
  return { signal: `${normalizedAction} ${confidence} ${stop} ${target}` };
}

async function requestClaudeSignal(marketData, requestApiKey = apiKey,
                                  requestModel = model) {
  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": requestApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: requestModel,
      max_tokens: 512,
      output_config: { effort: "low" },
      system: SIGNAL_SYSTEM_PROMPT + CHART_PATTERN_GUIDANCE +
              CHART_ILLUSTRATION_GUIDANCE + CANDLESTICK_GUIDANCE +
              MULTI_TIMEFRAME_GUIDANCE + STRUCTURE_BASED_RISK_GUIDANCE +
              STRUCTURE_PATTERN_EXIT_GUIDANCE +
              SUPPORT_RESISTANCE_CONSOLIDATION_GUIDANCE +
              QUALITY_FIRST_GUIDANCE + QUALITY_FIRST_PRECEDENCE +
              EXIT_MAPPING_GUIDANCE,
      messages: [{ role: "user", content: marketData }],
    }),
    signal: AbortSignal.timeout(18_000),
  });

  const result = await upstream.json();
  if (!upstream.ok) {
    const apiMessage = typeof result.error?.message === "string"
      ? result.error.message.slice(0, 500)
      : "No error details returned";
    throw new Error(`Anthropic API returned HTTP ${upstream.status}: ${apiMessage}`);
  }
  const blocks = Array.isArray(result.content) ? result.content : [];
  const signalText = extractSignalTextFromBlocks(blocks);
  if (!signalText)
    throw new InvalidSignalError("Claude returned an empty signal");
  return parseSignal(signalText);
}

async function runSignalAnalysis(marketData, requestApiKey, requestModel = DEFAULT_MODEL) {
  const result = await requestClaudeSignal(marketData, requestApiKey, requestModel);
  if (result.signal.startsWith("HOLD "))
    return requestClaudeSignal(`${marketData}\n\n${FORCED_DIRECTION_RETRY}`,
                               requestApiKey, requestModel);
  return result;
}

async function handleSignal(request, response) {
  if (!apiKey) {
    const error = "Anthropic API key is not configured. Enter it in the local dashboard.";
    lastError = error;
    lastSignal = "Prediction request blocked: API key not configured";
    console.warn(`Claude signal request blocked: ${error}`);
    sendJson(response, 503, { error });
    return;
  }
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }
  if (typeof payload.market_data !== "string" ||
      payload.market_data.length === 0 ||
      payload.market_data.length > MAX_MARKET_DATA_CHARS) {
    sendJson(response, 400, { error: "market_data must be a non-empty string within the size limit" });
    return;
  }

  requestCount += 1;
  lastRequestAt = new Date().toLocaleString();
  lastError = "";
  lastSignal = "M5 prediction in progress";
  try {
    const result = await requestClaudeSignal(payload.market_data);
    let selected = result;
    if (selected.signal.startsWith("HOLD ")) {
      requestCount += 1;
      lastRequestAt = new Date().toLocaleString();
      lastSignal = "Claude returned HOLD; retrying with mandatory BUY/SELL selection";
      selected = await requestClaudeSignal(
        `${payload.market_data}\n\n${FORCED_DIRECTION_RETRY}`
      );
    }
    lastSignal = selected.signal;
    sendJson(response, 200, { signal: selected.signal });
  } catch (error) {
    if (error instanceof InvalidSignalError) {
      lastSignal = "HOLD 0 0 0 (Claude response could not be verified)";
      console.warn(`Claude response rejected without retry: ${error.message}`);
      sendJson(response, 200, { signal: "HOLD 0 0 0", reason: error.message });
      return;
    }
    lastError = error.name === "TimeoutError" ? "Claude request timed out" : error.message;
    lastSignal = "Prediction request failed";
    console.error(`Claude signal request failed: ${lastError}`);
    sendJson(response, 502, { error: lastError });
  }
}

const server = http.createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");

  if (request.headers.origin && !ALLOWED_ORIGINS.has(request.headers.origin)) {
    sendJson(response, 403, { error: "Cross-origin requests are not allowed" });
    return;
  }

  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  if ((request.method === "GET" || request.method === "HEAD") &&
      (url.pathname === "/" || url.pathname === "/dashboard" ||
       url.pathname.startsWith("/downloads/") || url.pathname === "/animations.js")) {
    if (url.pathname === "/dashboard") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(dashboard),
      });
      response.end(request.method === "HEAD" ? undefined : dashboard);
      return;
    }

    let relativePath;
    try {
      relativePath = url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname.slice(1));
    } catch {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }
    const filePath = path.resolve(WEBSITE_ROOT, relativePath);
    const relativeToRoot = path.relative(WEBSITE_ROOT, filePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      sendJson(response, 403, { error: "Forbidden" });
      return;
    }
    try {
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        "Content-Type": WEBSITE_MIME_TYPES.get(path.extname(filePath).toLowerCase()) ||
          "application/octet-stream",
        "Content-Length": content.length,
        "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "EISDIR")
        console.error(`Website file read failed: ${error.message}`);
      response.writeHead(error.code === "ENOENT" || error.code === "EISDIR" ? 404 : 500);
      response.end(error.code === "ENOENT" || error.code === "EISDIR"
        ? "Not found" : "Internal server error");
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    const heartbeatFresh = lastHeartbeatAt !== null && Date.now() - Date.parse(lastHeartbeatAt) < 120_000;
    sendJson(response, 200, {
      configured: Boolean(apiKey),
      model,
      request_count: requestCount,
      last_request_at: lastRequestAt,
      last_signal: lastSignal,
      last_execution_status: lastExecutionStatus,
      last_execution_at: lastExecutionAt,
      last_error: lastError,
      ea_connected: heartbeatFresh,
      ea_last_seen_at: lastHeartbeatAt,
      ea_symbol: eaSymbol,
      ea_timeframe: eaTimeframe,
      ea_version: eaVersion,
      ea_trading_enabled: eaTradingEnabled,
      lot_size: lotSize,
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/execution") {
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      sendJson(response, 415, { error: "Content-Type must be application/json" });
      return;
    }
    let payload;
    try {
      payload = await readJson(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }
    if (typeof payload.status !== "string" ||
        payload.status.trim().length < 1 ||
        payload.status.length > 300) {
      sendJson(response, 400, { error: "Execution status must contain 1 to 300 characters" });
      return;
    }
    lastExecutionStatus = payload.status.trim();
    lastExecutionAt = new Date().toLocaleString();
    sendJson(response, 200, { saved: true, status: lastExecutionStatus });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/lot-size") {
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      sendJson(response, 415, { error: "Content-Type must be application/json" });
      return;
    }
    let payload;
    try {
      payload = await readJson(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }
    if (typeof payload.lot_size !== "number" ||
        !Number.isFinite(payload.lot_size) ||
        payload.lot_size < 0.01 ||
        payload.lot_size > 100) {
      sendJson(response, 400, { error: "Lot size must be a number between 0.01 and 100" });
      return;
    }
    lotSize = payload.lot_size;
    sendJson(response, 200, { saved: true, lot_size: lotSize });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/heartbeat") {
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      sendJson(response, 415, { error: "Content-Type must be application/json" });
      return;
    }
    let payload;
    try {
      payload = await readJson(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }
    if (typeof payload.symbol !== "string" || payload.symbol.length < 1 || payload.symbol.length > 32 ||
        typeof payload.timeframe !== "string" || payload.timeframe.length < 1 || payload.timeframe.length > 16 ||
        (payload.ea_version !== undefined &&
         (typeof payload.ea_version !== "string" || payload.ea_version.length > 16)) ||
        typeof payload.trading_enabled !== "boolean") {
      sendJson(response, 400, { error: "Heartbeat requires valid symbol, timeframe and trading_enabled fields" });
      return;
    }
    lastHeartbeatAt = new Date().toISOString();
    eaSymbol = payload.symbol;
    eaTimeframe = payload.timeframe;
    eaVersion = payload.ea_version || "";
    eaTradingEnabled = payload.trading_enabled;
    sendJson(response, 200, { connected: true, lot_size: lotSize });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/config") {
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      sendJson(response, 415, { error: "Content-Type must be application/json" });
      return;
    }
    let payload;
    try {
      payload = await readJson(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }
    if (typeof payload.api_key !== "string") {
      sendJson(response, 400, { error: "API key must be text" });
      return;
    }
    if (payload.api_key.trim().length > 0 && payload.api_key.trim().length < 10) {
      sendJson(response, 400, { error: "Enter a valid Anthropic API key" });
      return;
    }
    if (typeof payload.model !== "string" ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(payload.model)) {
      sendJson(response, 400, { error: "Model name contains invalid characters" });
      return;
    }
    const keyUpdated = payload.api_key.trim().length > 0;
    if (keyUpdated)
      apiKey = payload.api_key.trim();
    else if (!apiKey) {
      sendJson(response, 400, { error: "Enter your Anthropic API key" });
      return;
    }
    model = payload.model;
    sendJson(response, 200, { saved: true, configured: true, key_updated: keyUpdated, model });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/signal") {
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      sendJson(response, 415, { error: "Content-Type must be application/json" });
      return;
    }
    await handleSignal(request, response);
    return;
  }
  sendJson(response, 404, { error: "Not found" });
});

if (require.main === module) {
  server.on("error", (error) => {
    console.error(`Could not start the local bridge: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(PORT, HOST, () => {
    console.log(`Claude MT5 dashboard: http://${HOST}:${PORT}`);
    console.log("Local-only bridge started. Press Ctrl+C to stop it.");
    if (apiKey) console.log("An API key was loaded from the ANTHROPIC_API_KEY environment variable.");
  });

  function clearApiKeyAndStop() {
    apiKey = "";
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  }

  process.on("SIGINT", clearApiKeyAndStop);
  process.on("SIGTERM", clearApiKeyAndStop);
}

module.exports = { runSignalAnalysis, InvalidSignalError, MAX_MARKET_DATA_CHARS };
