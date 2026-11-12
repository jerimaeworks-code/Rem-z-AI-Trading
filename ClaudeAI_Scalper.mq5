#property strict
#property version   "1.21"
#property description "Claude-directed M5 entries with broker-side structural SL/TP"

#include <Trade/Trade.mqh>

input bool   InpUseHostedService = true;
input string InpAnthropicApiKey = "";
input string InpClaudeModel = "claude-sonnet-5-5";
input double InpLotSize = 0.01;
input bool   InpEnableTrading = true;
input bool   InpEnforcePerTradeRiskCap = false;
input bool   InpEnforceDailyDrawdown = false;
input double InpRiskPercent = 0.25;
input double InpMaxDailyDrawdownPercent = 5.0;
input int    InpMaxSpreadPoints = 100;
input int    InpMinStopLossPoints = 100;
input int    InpMaxStopLossPoints = 2000;
input int    InpMinTakeProfitPoints = 100;
input int    InpMaxTakeProfitPoints = 3000;
input int    InpRequestTimeoutMs = 45000;
input int    InpMaxDeviationPoints = 20;
input ulong  InpMagicNumber = 35023301;

const string LOCAL_SIGNAL_URL = "http://127.0.0.1:8765/api/signal";
const string HOSTED_SIGNAL_URL = "https://remzaitrading.vercel.app/api/signal";
const int MAX_OPEN_POSITIONS_PER_ACCOUNT = 1;
CTrade trade;
int emaFastHandle = INVALID_HANDLE;
int emaSlowHandle = INVALID_HANDLE;
int emaLongHandle = INVALID_HANDLE;
int rsiHandle = INVALID_HANDLE;
int atrHandle = INVALID_HANDLE;
int macdHandle = INVALID_HANDLE;
int momentumHandle = INVALID_HANDLE;
int bandsHandle = INVALID_HANDLE;
int stochasticHandle = INVALID_HANDLE;
int adxHandle = INVALID_HANDLE;
datetime lastBarTime = 0;
datetime lastAnalyzedBarTime = 0;
datetime lastHeartbeatAttemptTime = 0;
double dayStartEquity = 0.0;
string dayBaselineKey = "";
double configuredLotSize = 0.01;

int OnInit()
{
   if(InpLotSize < 0.01 || InpLotSize > 100.0)
   {
      Print("Lot size must be between 0.01 and 100.00 lots.");
      return INIT_PARAMETERS_INCORRECT;
   }
   string modelName = InpClaudeModel;
   StringTrimLeft(modelName);
   StringTrimRight(modelName);
   if(modelName == "" || StringLen(modelName) > 100)
   {
      Print("Claude model must contain 1-100 valid ASCII letters, numbers, periods, underscores or hyphens.");
      return INIT_PARAMETERS_INCORRECT;
   }
   for(int modelIndex = 0; modelIndex < StringLen(modelName); modelIndex++)
   {
      ushort character = StringGetCharacter(modelName, modelIndex);
      if(!((character >= 48 && character <= 57) ||
           (character >= 65 && character <= 90) ||
           (character >= 97 && character <= 122) ||
           character == 46 || character == 95 || character == 45))
      {
         Print("Claude model must contain 1-100 valid ASCII letters, numbers, periods, underscores or hyphens.");
         return INIT_PARAMETERS_INCORRECT;
      }
   }
   string anthropicKey = InpAnthropicApiKey;
   StringTrimLeft(anthropicKey);
   StringTrimRight(anthropicKey);
   if(StringLen(anthropicKey) > 512 ||
      StringFind(anthropicKey, "\r") >= 0 ||
      StringFind(anthropicKey, "\n") >= 0)
   {
      Print("Anthropic API key is invalid; use a key up to 512 characters with no line breaks.");
      return INIT_PARAMETERS_INCORRECT;
   }
   configuredLotSize = InpLotSize;
   if(_Period != PERIOD_M5)
   {
      Print("Attach this EA to an M5 chart.");
      return INIT_FAILED;
   }
   if(InpRiskPercent < 0.0 || InpRiskPercent > 1.0 ||
      (InpEnforcePerTradeRiskCap && InpRiskPercent <= 0.0) ||
      (InpEnforceDailyDrawdown &&
       (InpMaxDailyDrawdownPercent <= 0.0 || InpMaxDailyDrawdownPercent > 5.0)) ||
      InpMaxSpreadPoints <= 0 || InpMaxSpreadPoints > 100 ||
      InpMinStopLossPoints <= 0 || InpMaxStopLossPoints < InpMinStopLossPoints ||
      InpMinTakeProfitPoints <= 0 || InpMaxTakeProfitPoints < InpMinTakeProfitPoints ||
      InpRequestTimeoutMs < 1000 || InpRequestTimeoutMs > 60000 ||
      InpMaxDeviationPoints < 0)
   {
      Print("Invalid inputs. Maximum spread is 100 points; enabled per-trade risk and daily drawdown limits may not exceed 1% and 5% respectively.");
      return INIT_PARAMETERS_INCORRECT;
   }

   emaFastHandle = iMA(_Symbol, PERIOD_M5, 20, 0, MODE_EMA, PRICE_CLOSE);
   emaSlowHandle = iMA(_Symbol, PERIOD_M5, 50, 0, MODE_EMA, PRICE_CLOSE);
   emaLongHandle = iMA(_Symbol, PERIOD_M5, 200, 0, MODE_EMA, PRICE_CLOSE);
   rsiHandle = iRSI(_Symbol, PERIOD_M5, 14, PRICE_CLOSE);
   atrHandle = iATR(_Symbol, PERIOD_M5, 14);
   macdHandle = iMACD(_Symbol, PERIOD_M5, 12, 26, 9, PRICE_CLOSE);
   momentumHandle = iMomentum(_Symbol, PERIOD_M5, 14, PRICE_CLOSE);
   bandsHandle = iBands(_Symbol, PERIOD_M5, 20, 0, 2.0, PRICE_CLOSE);
   stochasticHandle = iStochastic(_Symbol, PERIOD_M5, 5, 3, 3, MODE_SMA, STO_LOWHIGH);
   adxHandle = iADX(_Symbol, PERIOD_M5, 14);
   if(emaFastHandle == INVALID_HANDLE || emaSlowHandle == INVALID_HANDLE ||
      emaLongHandle == INVALID_HANDLE || rsiHandle == INVALID_HANDLE ||
      atrHandle == INVALID_HANDLE || macdHandle == INVALID_HANDLE ||
      momentumHandle == INVALID_HANDLE || bandsHandle == INVALID_HANDLE ||
      stochasticHandle == INVALID_HANDLE || adxHandle == INVALID_HANDLE)
   {
      PrintFormat("Could not create indicator handles. Error %d", GetLastError());
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetDeviationInPoints((ulong)InpMaxDeviationPoints);
   lastBarTime = iTime(_Symbol, PERIOD_M5, 0);
   lastAnalyzedBarTime = lastBarTime;
   RefreshDailyBaseline();
   PrintFormat("Claude AI Scalper v1.21 initialized on M5. Claude predicts once per new M5 candle only when the account has no open positions; maximum spread is %d points and the account-wide open-position limit is one. Positions use broker-side structural SL and TP from Claude's signal; no fixed account-currency close is applied.",
               InpMaxSpreadPoints);
   if(InpUseHostedService)
      Print("Hosted HTTPS signal service enabled. Add https://remzaitrading.vercel.app to MT5 WebRequest settings; enter your own Anthropic API key in EA inputs.");
   else
      Print("Local bridge enabled. Add http://127.0.0.1:8765 to MT5 WebRequest settings and keep the local bridge running.");
   Print(InpEnforcePerTradeRiskCap
         ? "Per-trade risk cap is enabled."
         : "Per-trade risk cap is disabled; broker-valid volume is allowed only if required margin is available. SL/TP controls remain active.");
   if(InpEnforceDailyDrawdown)
      PrintFormat("Daily equity drawdown stop is enabled at %.2f%% from the broker server day's starting equity.",
                  InpMaxDailyDrawdownPercent);
   else
      Print("Daily equity drawdown stop is disabled by EA input; trading may continue after daily losses.");
   Print("Claude decides the entry before order submission. Each flat-account M5 signal request may consume API credits even when no order is executed.");
   Print("Live trading can lose real funds. No win rate is guaranteed.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(emaFastHandle != INVALID_HANDLE) IndicatorRelease(emaFastHandle);
   if(emaSlowHandle != INVALID_HANDLE) IndicatorRelease(emaSlowHandle);
   if(emaLongHandle != INVALID_HANDLE) IndicatorRelease(emaLongHandle);
   if(rsiHandle != INVALID_HANDLE) IndicatorRelease(rsiHandle);
   if(atrHandle != INVALID_HANDLE) IndicatorRelease(atrHandle);
   if(macdHandle != INVALID_HANDLE) IndicatorRelease(macdHandle);
   if(momentumHandle != INVALID_HANDLE) IndicatorRelease(momentumHandle);
   if(bandsHandle != INVALID_HANDLE) IndicatorRelease(bandsHandle);
   if(stochasticHandle != INVALID_HANDLE) IndicatorRelease(stochasticHandle);
   if(adxHandle != INVALID_HANDLE) IndicatorRelease(adxHandle);
}

void TightenStopsForOpenPositions(const string action, const int stopLossPoints)
{
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick) || tick.ask <= 0.0 || tick.bid <= 0.0)
      return;

   long stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minimumDistance = stopsLevel * _Point;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || PositionGetString(POSITION_SYMBOL) != _Symbol ||
         (ulong)PositionGetInteger(POSITION_MAGIC) != InpMagicNumber)
         continue;

      ENUM_POSITION_TYPE positionType =
         (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      if((action == "BUY" && positionType != POSITION_TYPE_BUY) ||
         (action == "SELL" && positionType != POSITION_TYPE_SELL))
         continue;

      double currentStop = PositionGetDouble(POSITION_SL);
      double currentTakeProfit = PositionGetDouble(POSITION_TP);
      double candidateStop = (positionType == POSITION_TYPE_BUY)
                             ? tick.bid - stopLossPoints * _Point
                             : tick.ask + stopLossPoints * _Point;
      candidateStop = NormalizeDouble(candidateStop, _Digits);
      if(positionType == POSITION_TYPE_BUY)
      {
         if(candidateStop <= 0.0 || candidateStop >= tick.bid ||
            tick.bid - candidateStop < minimumDistance ||
            (currentStop > 0.0 && candidateStop <= currentStop + _Point * 0.5))
            continue;
      }
      else if(candidateStop <= tick.ask ||
              candidateStop - tick.ask < minimumDistance ||
              (currentStop > 0.0 && candidateStop >= currentStop - _Point * 0.5))
         continue;

      if(!trade.PositionModify(ticket, candidateStop, currentTakeProfit) ||
         (trade.ResultRetcode() != TRADE_RETCODE_DONE &&
          trade.ResultRetcode() != TRADE_RETCODE_NO_CHANGES))
         PrintFormat("Could not tighten SL for position %I64u: %s (%u).",
                     ticket, trade.ResultRetcodeDescription(), trade.ResultRetcode());
      else
         PrintFormat("Claude reassessment tightened %s position %I64u SL to %.*f.",
                     (positionType == POSITION_TYPE_BUY) ? "BUY" : "SELL",
                     ticket, _Digits, candidateStop);
   }
}

void OnTick()
{
   ProcessEA();
}

void ProcessEA()
{
   datetime barTime = iTime(_Symbol, PERIOD_M5, 0);
   if(barTime == 0)
      return;

   if(barTime != lastBarTime)
   {
      lastBarTime = barTime;
      RefreshDailyBaseline();
   }

   if(MQLInfoInteger(MQL_TESTER))
   {
      Print("WebRequest is unavailable in the MT5 Strategy Tester; no order sent.");
      return;
   }
   datetime now = TimeCurrent();
   if(now - lastHeartbeatAttemptTime >= 30)
   {
      lastHeartbeatAttemptTime = now;
      if(!InpUseHostedService && !ReportBridgeHeartbeat())
         return;
   }
   if(lastAnalyzedBarTime == barTime)
      return;
   lastAnalyzedBarTime = barTime;

   if(InpEnableTrading && (!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ||
                           !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)))
   {
      Print("Trading is not permitted by the terminal or account.");
      ReportExecutionStatus("No trade: enable Algo Trading and verify the account allows trading.");
      return;
   }
   int openPositions = 0;
   if(!CountOpenPositionsOnAccount(openPositions))
   {
      ReportExecutionStatus("No signal requested: could not safely check open account positions.");
      return;
   }
   if(openPositions >= MAX_OPEN_POSITIONS_PER_ACCOUNT)
   {
      ReportExecutionStatus("Local entry skipped: an account position already exists; no additional trade or Claude request will be made.");
      return;
   }
   if(InpEnableTrading && InpEnforceDailyDrawdown && DailyDrawdownLimitReached())
   {
      ReportExecutionStatus("No trade: configured daily drawdown limit has been reached.");
      return;
   }

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick) || tick.ask <= 0.0 || tick.bid <= 0.0)
   {
      Print("No valid quote is available; skipping this bar.");
      ReportExecutionStatus("No trade: MT5 has no valid quote for this symbol.");
      return;
   }
   double spreadPoints = (tick.ask - tick.bid) / _Point;

   string prompt;
   if(!BuildMarketPrompt(prompt))
   {
      ReportExecutionStatus("No trade: insufficient closed candle or indicator data.");
      return;
   }

   string signalText;
   string requestFailureReason;
   if(!RequestSignal(prompt, signalText, requestFailureReason))
   {
      ReportExecutionStatus("Claude signal request failed: " + requestFailureReason);
      return;
   }

   string action;
   int confidence = 0;
   int claudeStopLossPoints = 0;
   int claudeTakeProfitPoints = 0;
   if(!ParseSignal(signalText, action, confidence, claudeStopLossPoints,
                   claudeTakeProfitPoints))
   {
      Print("Claude response did not match the required format; skipping this bar.");
      ReportExecutionStatus("No trade: Claude response was not in the required signal format.");
      return;
   }
   if(action == "HOLD")
   {
      Print("Claude returned HOLD after the bridge's forced-direction retry; no order will be sent.");
      ReportExecutionStatus("No trade: Claude still returned HOLD after one forced BUY/SELL retry.");
      return;
   }
   int stopLossPoints = claudeTakeProfitPoints;
   int tradeTakeProfitPoints = claudeStopLossPoints;
   if(stopLossPoints < InpMinStopLossPoints || stopLossPoints > InpMaxStopLossPoints ||
      tradeTakeProfitPoints < InpMinTakeProfitPoints ||
      tradeTakeProfitPoints > InpMaxTakeProfitPoints)
   {
      ReportExecutionStatus("No trade: swapped Claude SL/TP distances are outside the configured MT5 SL/TP limits.");
      return;
   }

   PrintFormat("Claude M5 prediction: %s, confidence %d, Claude SL %d points -> MT5 TP %d; Claude TP %d points -> MT5 SL %d; spread %.1f points.",
               action, confidence, claudeStopLossPoints,
               tradeTakeProfitPoints, claudeTakeProfitPoints,
               stopLossPoints, spreadPoints);
   if(!InpEnableTrading)
   {
      ReportExecutionStatus(StringFormat("Signal only: %s confidence %d; Claude SL maps to MT5 TP %d points, Claude TP maps to MT5 SL %d points; trading is disabled.",
                                         action, confidence, tradeTakeProfitPoints,
                                         stopLossPoints));
      return;
   }

   ReportExecutionStatus(StringFormat("Claude signal: %s confidence %d; mapped MT5 TP %d points and SL %d points; validating %.2f lots and broker rules.",
                                      action, confidence,
                                      tradeTakeProfitPoints,
                                      stopLossPoints,
                                      configuredLotSize));
   bool executionConfirmed = false;
   ulong dealTicket = 0;
   string executionResult = PlaceRiskLimitedOrder(action, stopLossPoints,
                                                   tradeTakeProfitPoints,
                                                   configuredLotSize,
                                                   executionConfirmed,
                                                   dealTicket);
   if(!executionConfirmed)
      executionResult = StringSubstr(executionResult, 0, 210) +
                        " Claude was already called for this pre-trade prediction.";
   ReportExecutionStatus(executionResult);
}

bool ReportBridgeHeartbeat()
{
   string body = "{\"symbol\":\"" + EscapeJson(_Symbol) +
                 "\",\"timeframe\":\"" + EnumToString(_Period) +
                 "\",\"ea_version\":\"1.21" +
                 "\",\"trading_enabled\":" + (InpEnableTrading ? "true" : "false") + "}";
   char request[];
   int requestLength = StringToCharArray(body, request, 0, WHOLE_ARRAY, CP_UTF8);
   if(requestLength <= 1)
   {
      Print("Could not encode the local bridge heartbeat.");
      return false;
   }
   ArrayResize(request, requestLength - 1);

   char response[];
   string responseHeaders;
   ResetLastError();
   int status = WebRequest("POST", "http://127.0.0.1:8765/api/heartbeat",
                           "Content-Type: application/json\r\n",
                           3000, request, response, responseHeaders);
   if(status != 200)
   {
      if(status == -1)
         PrintFormat("Local bridge heartbeat failed (error %d). Start the dashboard and allow http://127.0.0.1:8765 in MT5 WebRequest settings.",
                     GetLastError());
      else
         PrintFormat("Local bridge heartbeat returned HTTP %d.", status);
      return false;
   }
   string responseText = CharArrayToString(response, 0, -1, CP_UTF8);
   if(!ExtractJsonNumber(responseText, "\"lot_size\"", configuredLotSize) ||
      configuredLotSize < 0.01 || configuredLotSize > 100.0)
   {
      Print("Local bridge returned an invalid lot size; no signal will be processed.");
      return false;
   }
   return true;
}

void ReportExecutionStatus(const string statusText)
{
   if(InpUseHostedService)
   {
      Print(statusText);
      return;
   }
   string body = "{\"status\":\"" + EscapeJson(statusText) + "\"}";
   char request[];
   int requestLength = StringToCharArray(body, request, 0, WHOLE_ARRAY, CP_UTF8);
   if(requestLength <= 1)
   {
      Print("Could not encode execution status for the local dashboard.");
      return;
   }
   ArrayResize(request, requestLength - 1);

   char response[];
   string responseHeaders;
   ResetLastError();
   int httpStatus = WebRequest("POST", "http://127.0.0.1:8765/api/execution",
                               "Content-Type: application/json\r\n",
                               2000, request, response, responseHeaders);
   if(httpStatus != 200)
   {
      if(httpStatus == -1)
         PrintFormat("Could not report execution status to the dashboard (error %d).",
                     GetLastError());
      else
         PrintFormat("Execution status endpoint returned HTTP %d.", httpStatus);
   }
}
void RefreshDailyBaseline()
{
   MqlDateTime now;
   TimeToStruct(TimeCurrent(), now);
   string datePart = StringFormat("%04d%02d%02d", now.year, now.mon, now.day);
   dayBaselineKey = StringFormat("ClaudeScalperEq_%I64d_%s",
                                 AccountInfoInteger(ACCOUNT_LOGIN), datePart);
   if(!GlobalVariableCheck(dayBaselineKey))
      GlobalVariableSet(dayBaselineKey, AccountInfoDouble(ACCOUNT_EQUITY));
   dayStartEquity = GlobalVariableGet(dayBaselineKey);
}

bool DailyDrawdownLimitReached()
{
   if(dayStartEquity <= 0.0)
      return true;
   double drawdownPercent = (dayStartEquity - AccountInfoDouble(ACCOUNT_EQUITY)) /
                            dayStartEquity * 100.0;
   if(drawdownPercent >= InpMaxDailyDrawdownPercent)
   {
      PrintFormat("Daily equity drawdown limit reached (%.2f%%). No new orders will be placed.",
                  drawdownPercent);
      return true;
   }
   return false;
}

bool CountOpenPositionsOnAccount(int &count)
{
   count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
      {
         PrintFormat("Could not inspect open account position at index %d (error %d).",
                     i, GetLastError());
         return false;
      }
      count++;
   }
   return true;
}

void FindPivotSupportResistance(const MqlRates &rates[], const int count,
                                const double referencePrice,
                                const double tolerance,
                                double &support, int &supportTouches,
                                double &resistance, int &resistanceTouches)
{
   support = 0.0;
   resistance = 0.0;
   supportTouches = 0;
   resistanceTouches = 0;
   double nearestSupportDistance = DBL_MAX;
   double nearestResistanceDistance = DBL_MAX;

   for(int i = 2; i < count - 2; i++)
   {
      bool isSwingHigh = rates[i].high > rates[i - 1].high &&
                         rates[i].high >= rates[i + 1].high &&
                         rates[i].high > rates[i - 2].high &&
                         rates[i].high >= rates[i + 2].high;
      if(isSwingHigh && rates[i].high > referencePrice)
      {
         int touches = 0;
         for(int j = 2; j < count - 2; j++)
         {
            bool isPivot = rates[j].high > rates[j - 1].high &&
                           rates[j].high >= rates[j + 1].high &&
                           rates[j].high > rates[j - 2].high &&
                           rates[j].high >= rates[j + 2].high;
            if(isPivot && MathAbs(rates[j].high - rates[i].high) <= tolerance)
               touches++;
         }
         double distance = rates[i].high - referencePrice;
         if(distance < nearestResistanceDistance)
         {
            nearestResistanceDistance = distance;
            resistance = rates[i].high;
            resistanceTouches = touches;
         }
      }

      bool isSwingLow = rates[i].low < rates[i - 1].low &&
                        rates[i].low <= rates[i + 1].low &&
                        rates[i].low < rates[i - 2].low &&
                        rates[i].low <= rates[i + 2].low;
      if(isSwingLow && rates[i].low < referencePrice)
      {
         int touches = 0;
         for(int j = 2; j < count - 2; j++)
         {
            bool isPivot = rates[j].low < rates[j - 1].low &&
                           rates[j].low <= rates[j + 1].low &&
                           rates[j].low < rates[j - 2].low &&
                           rates[j].low <= rates[j + 2].low;
            if(isPivot && MathAbs(rates[j].low - rates[i].low) <= tolerance)
               touches++;
         }
         double distance = referencePrice - rates[i].low;
         if(distance < nearestSupportDistance)
         {
            nearestSupportDistance = distance;
            support = rates[i].low;
            supportTouches = touches;
         }
      }
   }
}

bool EvaluateLocalTrade(string &action, int &confidence,
                        int &stopLossPoints, int &activeTakeProfitPoints,
                        string &reason)
{
   action = "";
   confidence = 0;
   stopLossPoints = 0;
   activeTakeProfitPoints = 0;
   reason = "No confirmed trend-aligned support/resistance rejection.";

   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(_Symbol, PERIOD_M5, 1, 120, rates);
   if(copied != 120)
   {
      reason = "120 closed M5 candles are not available.";
      return false;
   }

   double ema20[], ema50[], atr[];
   if(CopyBuffer(emaFastHandle, 0, 1, 1, ema20) != 1 ||
      CopyBuffer(emaSlowHandle, 0, 1, 1, ema50) != 1 ||
      CopyBuffer(atrHandle, 0, 1, 1, atr) != 1 ||
      ema20[0] <= 0.0 || ema50[0] <= 0.0 || atr[0] <= 0.0)
   {
      reason = "Local M5 EMA or ATR data is unavailable.";
      return false;
   }

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick) || tick.ask <= 0.0 || tick.bid <= 0.0)
   {
      reason = "No valid executable quote is available.";
      return false;
   }

   const MqlRates signalBar = rates[copied - 1];
   const MqlRates previousBar = rates[copied - 2];
   double range = signalBar.high - signalBar.low;
   double body = MathAbs(signalBar.close - signalBar.open);
   if(range <= 0.0 || body <= 0.0)
   {
      reason = "Latest closed M5 candle has no directional body.";
      return false;
   }
   double lowerWick = MathMin(signalBar.open, signalBar.close) -
                      signalBar.low;
   double upperWick = signalBar.high -
                      MathMax(signalBar.open, signalBar.close);
   bool bullishEngulfing = (signalBar.close > signalBar.open &&
                            previousBar.close < previousBar.open &&
                            signalBar.open <= previousBar.close &&
                            signalBar.close >= previousBar.open);
   bool bearishEngulfing = (signalBar.close < signalBar.open &&
                            previousBar.close > previousBar.open &&
                            signalBar.open >= previousBar.close &&
                            signalBar.close <= previousBar.open);
   bool bullishResponse = (signalBar.close > signalBar.open &&
                           (lowerWick >= body * 0.5 || bullishEngulfing));
   bool bearishResponse = (signalBar.close < signalBar.open &&
                           (upperWick >= body * 0.5 || bearishEngulfing));

   double midpoint = (tick.ask + tick.bid) * 0.5;
   double tolerance = MathMax(atr[0] * 0.15, _Point * 5.0);
   double support = 0.0;
   double resistance = 0.0;
   int supportTouches = 0;
   int resistanceTouches = 0;
   FindPivotSupportResistance(rates, copied, midpoint, tolerance,
                              support, supportTouches,
                              resistance, resistanceTouches);

   double supportDistance = (support > 0.0)
                            ? MathAbs(signalBar.low - support)
                            : DBL_MAX;
   double resistanceDistance = (resistance > 0.0)
                               ? MathAbs(resistance - signalBar.high)
                               : DBL_MAX;
   bool buySetup = ema20[0] > ema50[0] &&
                   signalBar.close > ema20[0] &&
                   support > 0.0 && supportTouches >= 2 &&
                   signalBar.close > support &&
                   signalBar.low <= support + atr[0] * 0.30 &&
                   supportDistance <= atr[0] * 0.35 &&
                   bullishResponse;
   bool sellSetup = ema20[0] < ema50[0] &&
                    signalBar.close < ema20[0] &&
                    resistance > 0.0 && resistanceTouches >= 2 &&
                    signalBar.close < resistance &&
                    signalBar.high >= resistance - atr[0] * 0.30 &&
                    resistanceDistance <= atr[0] * 0.35 &&
                    bearishResponse;

   if(buySetup == sellSetup)
   {
      reason = (buySetup)
               ? "Conflicting local BUY and SELL conditions."
               : "No trend-aligned rejection at a repeatedly tested M5 pivot.";
      return false;
   }

   action = buySetup ? "BUY" : "SELL";
   double entry = buySetup ? tick.ask : tick.bid;
   double structuralLevel = buySetup ? support : resistance;
   double opposingLevel = buySetup ? resistance : support;
   int opposingTouches = buySetup ? resistanceTouches : supportTouches;
   if(opposingLevel <= 0.0 || opposingTouches < 1)
   {
      reason = "No measured opposing M5 pivot is available for a structural target.";
      action = "";
      return false;
   }

   double spreadPoints = (tick.ask - tick.bid) / _Point;
   long brokerStopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double bufferPrice = MathMax(atr[0] * 0.15,
                                (spreadPoints + brokerStopsLevel + 1.0) * _Point);
   double stopDistance = buySetup
                         ? (entry - structuralLevel + bufferPrice) / _Point
                         : (structuralLevel - entry + bufferPrice) / _Point;
   double targetDistance = buySetup
                           ? (opposingLevel - entry - bufferPrice) / _Point
                           : (entry - opposingLevel - bufferPrice) / _Point;
   if(stopDistance <= 0.0 || targetDistance <= 0.0)
   {
      reason = "Structural SL or opposing-pivot TP is not on the valid side of entry.";
      action = "";
      return false;
   }

   stopLossPoints = (int)MathCeil(stopDistance);
   if(stopLossPoints < InpMinStopLossPoints ||
      stopLossPoints > InpMaxStopLossPoints)
   {
      reason = "Structural stop is outside configured SL distance limits.";
      action = "";
      stopLossPoints = 0;
      return false;
   }

   activeTakeProfitPoints = (int)MathFloor(MathMin(targetDistance,
                                                    stopLossPoints * 2.0));
   if(activeTakeProfitPoints < InpMinTakeProfitPoints ||
      activeTakeProfitPoints > InpMaxTakeProfitPoints ||
      activeTakeProfitPoints < MathCeil(stopLossPoints * 1.5))
   {
      reason = "Measured opposing pivot cannot provide the preferred minimum 1.5R reward within TP limits.";
      action = "";
      stopLossPoints = 0;
      activeTakeProfitPoints = 0;
      return false;
   }

   confidence = (bullishEngulfing || bearishEngulfing) ? 70 : 60;
   reason = StringFormat("%s trend pullback, closed-candle rejection, and repeated pivot support; SL %d points, active TP %d points.",
                         action, stopLossPoints, activeTakeProfitPoints);
   return true;
}

bool BuildTimeframeContext(const ENUM_TIMEFRAMES timeframe, string &context)
{
   context = EnumToString(timeframe) + " context unavailable\n";
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(_Symbol, timeframe, 1, 60, rates);
   if(copied != 60)
   {
      PrintFormat("%s history is not ready (%d/60 closed candles); continuing without this supporting timeframe.",
                  EnumToString(timeframe), copied);
      return false;
   }

   int ema20Handle = iMA(_Symbol, timeframe, 20, 0, MODE_EMA, PRICE_CLOSE);
   int ema50Handle = iMA(_Symbol, timeframe, 50, 0, MODE_EMA, PRICE_CLOSE);
   int rsiHandleLocal = iRSI(_Symbol, timeframe, 14, PRICE_CLOSE);
   int atrHandleLocal = iATR(_Symbol, timeframe, 14);
   int macdHandleLocal = iMACD(_Symbol, timeframe, 12, 26, 9, PRICE_CLOSE);
   int adxHandleLocal = iADX(_Symbol, timeframe, 14);
   if(ema20Handle == INVALID_HANDLE || ema50Handle == INVALID_HANDLE ||
      rsiHandleLocal == INVALID_HANDLE || atrHandleLocal == INVALID_HANDLE ||
      macdHandleLocal == INVALID_HANDLE || adxHandleLocal == INVALID_HANDLE)
   {
      PrintFormat("Could not create %s supporting indicator handles (error %d).",
                  EnumToString(timeframe), GetLastError());
      if(ema20Handle != INVALID_HANDLE) IndicatorRelease(ema20Handle);
      if(ema50Handle != INVALID_HANDLE) IndicatorRelease(ema50Handle);
      if(rsiHandleLocal != INVALID_HANDLE) IndicatorRelease(rsiHandleLocal);
      if(atrHandleLocal != INVALID_HANDLE) IndicatorRelease(atrHandleLocal);
      if(macdHandleLocal != INVALID_HANDLE) IndicatorRelease(macdHandleLocal);
      if(adxHandleLocal != INVALID_HANDLE) IndicatorRelease(adxHandleLocal);
      return false;
   }

   double ema20[], ema50[], rsi[], atr[], macd[], macdSignal[], adx[], plusDi[], minusDi[];
   bool dataReady = CopyBuffer(ema20Handle, 0, 1, 1, ema20) == 1 &&
                    CopyBuffer(ema50Handle, 0, 1, 1, ema50) == 1 &&
                    CopyBuffer(rsiHandleLocal, 0, 1, 1, rsi) == 1 &&
                    CopyBuffer(atrHandleLocal, 0, 1, 1, atr) == 1 &&
                    CopyBuffer(macdHandleLocal, 0, 1, 1, macd) == 1 &&
                    CopyBuffer(macdHandleLocal, 1, 1, 1, macdSignal) == 1 &&
                    CopyBuffer(adxHandleLocal, 0, 1, 1, adx) == 1 &&
                    CopyBuffer(adxHandleLocal, 1, 1, 1, plusDi) == 1 &&
                    CopyBuffer(adxHandleLocal, 2, 1, 1, minusDi) == 1;
   IndicatorRelease(ema20Handle);
   IndicatorRelease(ema50Handle);
   IndicatorRelease(rsiHandleLocal);
   IndicatorRelease(atrHandleLocal);
   IndicatorRelease(macdHandleLocal);
   IndicatorRelease(adxHandleLocal);
   if(!dataReady)
   {
      PrintFormat("%s supporting indicator data is not ready (error %d); continuing without this timeframe.",
                  EnumToString(timeframe), GetLastError());
      return false;
   }

   double support = 0.0;
   double resistance = 0.0;
   int supportTouches = 0;
   int resistanceTouches = 0;
   FindPivotSupportResistance(rates, copied, rates[copied - 1].close,
                              MathMax(atr[0] * 0.15, _Point * 5.0),
                              support, supportTouches,
                              resistance, resistanceTouches);
   context = EnumToString(timeframe) +
             " closed_bar=" + TimeToString(rates[copied - 1].time, TIME_DATE | TIME_MINUTES) +
             " close=" + DoubleToString(rates[copied - 1].close, _Digits) +
             " nearest_pivot_support=" +
             ((support > 0.0) ? DoubleToString(support, _Digits) : "unavailable") +
             " support_pivot_touches=" + (string)supportTouches +
             " nearest_pivot_resistance=" +
             ((resistance > 0.0) ? DoubleToString(resistance, _Digits) : "unavailable") +
             " resistance_pivot_touches=" + (string)resistanceTouches +
             " pivot_cluster_tolerance=" +
             DoubleToString(MathMax(atr[0] * 0.15, _Point * 5.0), _Digits) +
             " EMA20=" + DoubleToString(ema20[0], _Digits) +
             " EMA50=" + DoubleToString(ema50[0], _Digits) +
             " RSI14=" + DoubleToString(rsi[0], 2) +
             " ATR14=" + DoubleToString(atr[0], _Digits) +
             " MACD=" + DoubleToString(macd[0], _Digits) +
             " MACD_signal=" + DoubleToString(macdSignal[0], _Digits) +
             " ADX14=" + DoubleToString(adx[0], 2) +
             " plusDI=" + DoubleToString(plusDi[0], 2) +
             " minusDI=" + DoubleToString(minusDi[0], 2) +
             "\nRecent closed " + EnumToString(timeframe) +
             " candles oldest to newest (time,open,high,low,close):\n";
   for(int i = copied - 8; i < copied; i++)
   {
      context += TimeToString(rates[i].time, TIME_DATE | TIME_MINUTES) + "," +
                 DoubleToString(rates[i].open, _Digits) + "," +
                 DoubleToString(rates[i].high, _Digits) + "," +
                 DoubleToString(rates[i].low, _Digits) + "," +
                 DoubleToString(rates[i].close, _Digits) + "\n";
   }
   return true;
}

bool BuildMarketPrompt(string &prompt)
{
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(_Symbol, PERIOD_M5, 1, 120, rates);
   if(copied != 120)
   {
      PrintFormat("Only %d of 120 required closed M5 candles are available; skipping this bar.",
                  copied);
      return false;
   }

   double ema20[], ema50[], ema200[], rsi[], atr[];
   double macdMain[], macdSignal[], momentum[];
   double bandsBase[], bandsUpper[], bandsLower[];
   double stochMain[], stochSignal[], adx[], plusDi[], minusDi[];
   double rsiHistory[], middleHistory[], upperHistory[], lowerHistory[];
   if(CopyBuffer(emaFastHandle, 0, 1, 1, ema20) != 1 ||
      CopyBuffer(emaSlowHandle, 0, 1, 1, ema50) != 1 ||
      CopyBuffer(emaLongHandle, 0, 1, 1, ema200) != 1 ||
      CopyBuffer(rsiHandle, 0, 1, 1, rsi) != 1 ||
      CopyBuffer(atrHandle, 0, 1, 1, atr) != 1 ||
      CopyBuffer(macdHandle, 0, 1, 1, macdMain) != 1 ||
      CopyBuffer(macdHandle, 1, 1, 1, macdSignal) != 1 ||
      CopyBuffer(momentumHandle, 0, 1, 1, momentum) != 1 ||
      CopyBuffer(bandsHandle, 0, 1, 1, bandsBase) != 1 ||
      CopyBuffer(bandsHandle, 1, 1, 1, bandsUpper) != 1 ||
      CopyBuffer(bandsHandle, 2, 1, 1, bandsLower) != 1 ||
      CopyBuffer(stochasticHandle, 0, 1, 1, stochMain) != 1 ||
      CopyBuffer(stochasticHandle, 1, 1, 1, stochSignal) != 1 ||
      CopyBuffer(adxHandle, 0, 1, 1, adx) != 1 ||
      CopyBuffer(adxHandle, 1, 1, 1, plusDi) != 1 ||
      CopyBuffer(adxHandle, 2, 1, 1, minusDi) != 1 ||
      CopyBuffer(rsiHandle, 0, 1, 120, rsiHistory) != 120 ||
      CopyBuffer(bandsHandle, 0, 1, 21, middleHistory) != 21 ||
      CopyBuffer(bandsHandle, 1, 1, 21, upperHistory) != 21 ||
      CopyBuffer(bandsHandle, 2, 1, 21, lowerHistory) != 21)
   {
      Print("Indicator data is not ready; skipping this bar.");
      return false;
   }

   double currentBandWidth = bandsUpper[0] - bandsLower[0];
   double minimumPriorBandWidth = DBL_MAX;
   for(int i = 0; i < 20; i++)
   {
      double priorBandWidth = upperHistory[i] - lowerHistory[i];
      if(priorBandWidth < minimumPriorBandWidth)
         minimumPriorBandWidth = priorBandWidth;
   }
   bool isSqueeze = (minimumPriorBandWidth > 0.0 &&
                     currentBandWidth <= minimumPriorBandWidth);
   string squeezeState = isSqueeze
                         ? "lowest_of_20_prior_closed_bars"
                         : "not_lowest_of_20_prior_closed_bars";
   double middleBandSlope = middleHistory[20] - middleHistory[15];
   double normalizedMiddleBandSlope = (atr[0] > 0.0)
                                      ? middleBandSlope / atr[0]
                                      : 0.0;
   string middleBandState = (normalizedMiddleBandSlope > 0.10)
                            ? "uptrend"
                            : ((normalizedMiddleBandSlope < -0.10)
                               ? "downtrend"
                               : "flat_range");
   double signalBarVolume = (double)rates[copied - 1].tick_volume;
   double precedingFiveVolume = 0.0;
   for(int i = copied - 6; i < copied - 1; i++)
      precedingFiveVolume += (double)rates[i].tick_volume;
   precedingFiveVolume /= 5.0;
   double signalBarBody = MathAbs(rates[copied - 1].close -
                                  rates[copied - 1].open);
   double signalBarRange = rates[copied - 1].high - rates[copied - 1].low;
   double signalBarBodyFraction = (signalBarRange > 0.0)
                                  ? signalBarBody / signalBarRange
                                  : 0.0;
   double signalBarClose = rates[copied - 1].close;

   double dayVwap = 0.0;
   long dayVolume = 0;
   MqlDateTime dayParts;
   TimeToStruct(rates[copied - 1].time, dayParts);
   dayParts.hour = 0;
   dayParts.min = 0;
   dayParts.sec = 0;
   datetime dayStart = StructToTime(dayParts);
   MqlRates dayRates[];
   ArraySetAsSeries(dayRates, false);
   int dayBars = CopyRates(_Symbol, PERIOD_M5, dayStart,
                           rates[copied - 1].time, dayRates);
   if(dayBars > 0)
   {
      double weightedPrice = 0.0;
      for(int i = 0; i < dayBars; i++)
      {
         double typicalPrice = (dayRates[i].high + dayRates[i].low +
                                dayRates[i].close) / 3.0;
         weightedPrice += typicalPrice * (double)dayRates[i].tick_volume;
         dayVolume += (long)dayRates[i].tick_volume;
      }
      if(dayVolume > 0)
         dayVwap = weightedPrice / (double)dayVolume;
   }

   double swingHigh = rates[0].high;
   double swingLow = rates[0].low;
   int swingHighIndex = 0;
   int swingLowIndex = 0;
   for(int i = 1; i < copied; i++)
   {
      if(rates[i].high > swingHigh)
      {
         swingHigh = rates[i].high;
         swingHighIndex = i;
      }
      if(rates[i].low < swingLow)
      {
         swingLow = rates[i].low;
         swingLowIndex = i;
      }
   }
   double nearestM5Support = 0.0;
   double nearestM5Resistance = 0.0;
   int m5SupportTouches = 0;
   int m5ResistanceTouches = 0;
   FindPivotSupportResistance(rates, copied, rates[copied - 1].close,
                              MathMax(atr[0] * 0.15, _Point * 5.0),
                              nearestM5Support, m5SupportTouches,
                              nearestM5Resistance, m5ResistanceTouches);
   double fibRange = swingHigh - swingLow;
   string fibContext = "unverified";
   double fib236 = 0.0;
   double fib382 = 0.0;
   double fib500 = 0.0;
   double fib618 = 0.0;
   double fibExtension1272 = 0.0;
   double fibExtension1618 = 0.0;
   if(fibRange > 0.0 && swingLowIndex < swingHighIndex)
   {
      fibContext = "low_preceded_high";
      fib236 = swingHigh - fibRange * 0.236;
      fib382 = swingHigh - fibRange * 0.382;
      fib500 = swingHigh - fibRange * 0.5;
      fib618 = swingHigh - fibRange * 0.618;
      fibExtension1272 = swingHigh + fibRange * 0.272;
      fibExtension1618 = swingHigh + fibRange * 0.618;
   }
   else if(fibRange > 0.0)
   {
      fibContext = "high_preceded_low";
      fib236 = swingLow + fibRange * 0.236;
      fib382 = swingLow + fibRange * 0.382;
      fib500 = swingLow + fibRange * 0.5;
      fib618 = swingLow + fibRange * 0.618;
      fibExtension1272 = swingLow - fibRange * 0.272;
      fibExtension1618 = swingLow - fibRange * 0.618;
   }

   string rsiDivergence = "not_detected";
   int lastHighPivot = -1;
   int priorHighPivot = -1;
   int lastLowPivot = -1;
   int priorLowPivot = -1;
   for(int i = 2; i < copied - 2; i++)
   {
      bool isHigh = rates[i].high > rates[i - 1].high &&
                    rates[i].high >= rates[i + 1].high &&
                    rates[i].high > rates[i - 2].high &&
                    rates[i].high >= rates[i + 2].high;
      bool isLow = rates[i].low < rates[i - 1].low &&
                   rates[i].low <= rates[i + 1].low &&
                   rates[i].low < rates[i - 2].low &&
                   rates[i].low <= rates[i + 2].low;
      if(isHigh)
      {
         priorHighPivot = lastHighPivot;
         lastHighPivot = i;
      }
      if(isLow)
      {
         priorLowPivot = lastLowPivot;
         lastLowPivot = i;
      }
   }
   if(priorHighPivot >= 0 && lastHighPivot >= 0 &&
      rates[lastHighPivot].high > rates[priorHighPivot].high &&
      rsiHistory[lastHighPivot] < rsiHistory[priorHighPivot])
      rsiDivergence = "possible_bearish";
   else if(priorLowPivot >= 0 && lastLowPivot >= 0 &&
           rates[lastLowPivot].low < rates[priorLowPivot].low &&
           rsiHistory[lastLowPivot] > rsiHistory[priorLowPivot])
      rsiDivergence = "possible_bullish";

   double spreadPoints = (SymbolInfoDouble(_Symbol, SYMBOL_ASK) -
                          SymbolInfoDouble(_Symbol, SYMBOL_BID)) / _Point;
   double executableBid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double executableAsk = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   string higherTimeframeContext = "";
   string timeframeContext;
   BuildTimeframeContext(PERIOD_M15, timeframeContext);
   higherTimeframeContext += timeframeContext;
   BuildTimeframeContext(PERIOD_M30, timeframeContext);
   higherTimeframeContext += timeframeContext;
   BuildTimeframeContext(PERIOD_H1, timeframeContext);
   higherTimeframeContext += timeframeContext;
   if(StringFind(higherTimeframeContext, "closed_bar=") < 0)
      higherTimeframeContext = "M15, M30, H1 context unavailable; use M5 only.\n";

   string recentCandleGeometry = "";
   int firstRecentCandle = copied - 5;
   for(int i = firstRecentCandle; i < copied; i++)
   {
      double candleRange = rates[i].high - rates[i].low;
      double candleBody = MathAbs(rates[i].close - rates[i].open);
      double upperWick = rates[i].high - MathMax(rates[i].open, rates[i].close);
      double lowerWick = MathMin(rates[i].open, rates[i].close) - rates[i].low;
      double closeLocation = (candleRange > 0.0)
                             ? (rates[i].close - rates[i].low) / candleRange
                             : 0.0;
      recentCandleGeometry += TimeToString(rates[i].time, TIME_MINUTES) +
                              " body=" + DoubleToString(candleBody, _Digits) +
                              " upper_wick=" + DoubleToString(upperWick, _Digits) +
                              " lower_wick=" + DoubleToString(lowerWick, _Digits) +
                              " range=" + DoubleToString(candleRange, _Digits) +
                              " close_location_0_low_1_high=" +
                              DoubleToString(closeLocation, 2) + "\n";
   }

   prompt = "Analyze " + _Symbol + " with M5 as the ONLY execution timeframe. "
            "Use the supplied closed M15, M30 and H1 data only as supporting trend, "
            "momentum, and structure context; do not require those charts to be open. "
            "Use the latest CLOSED M5 candle and closed M5 history to choose the entry. Never execute "
            "from higher-timeframe data alone. If higher timeframe data is unavailable, "
            "say so and do not invent it. Use only supplied candle data and calculated "
            "indicator values. Do not assume indicators or chart objects not listed here. Treat indicators "
            "as supporting evidence, not independent confirmation or guarantees. "
            "Analyze closed-candle body, wicks, close location, and price sequence. "
            "Do not infer a future move from an incomplete candle. "
            "Bollinger Bands (M5, SMA20, deviation 2) and tested pivot levels are "
            "important evidence, not a mandatory order gate. Use the supplied 5-bar "
            "middle-band slope, band position, M5 pivot support/resistance, touch "
            "counts, and candle rejection to choose the best-supported direction. "
            "Explicitly check for a compact, overlapping closed-candle base at "
            "repeatedly tested support. If price holds the base and a bullish candle "
            "rejects support and closes back above it or breaks above the base, favor "
            "BUY rather than HOLD. Also check for a pullback/retest of repeatedly "
            "tested resistance or a descending resistance line objectively supported "
            "by swing highs. If the retest fails and a bearish candle rejects the "
            "level and closes back below it or the base, favor SELL rather than HOLD. "
            "Apply the reverse logic at the opposite boundary: require a closed break "
            "through a level or a retest holding on the other side before calling a "
            "breakout continuation; a touch alone is not enough. Do not invent a "
            "trendline or enter in the middle of a range. A qualified support-base "
            "or resistance-retest setup is first-class evidence; conflicting broader "
            "trend or indicators may lower confidence but must not force HOLD. "
            "In an uptrend, favor BUY; in a downtrend, favor SELL; but if the "
            "broader evidence supports the opposite direction, do not automatically "
            "reject it solely because of the middle-band slope. Range outer-band "
            "reentries and squeeze-break evidence may strengthen or weaken a signal, "
            "but their absence must not force HOLD. A wick is weaker evidence than a "
            "closed-candle break or rejection. Do not require a fixed pivot touch "
            "count, pattern, or BB setup before returning a signal. "
            "Analyze each supplied candle's body, upper/lower wicks, close position, "
            "preceding price movement, and nearby levels. Examine the recent five-candle "
            "geometry and full OHLC sequence for bullish engulfing, hammer, inverted "
            "hammer, morning star, piercing line, bullish harami, tweezer bottom, three "
            "white soldiers, bullish marubozu, bullish pin bar, dragonfly doji; bearish "
            "engulfing, shooting star, hanging man, evening star, dark cloud cover, "
            "bearish harami, tweezer top, three black crows, bearish marubozu, bearish "
            "pin bar, gravestone doji; and doji, spinning top, inside/outside bar, "
            "long-legged doji, harami cross, mother-bar breakout, rejection candle, "
            "and possible exhaustion candle. Identify only patterns whose candle "
            "sequence and context are present; do not force a pattern. Mark it forming, "
            "confirmed on closed candles, invalidated, or not identifiable. A hammer-like "
            "candle without a prior decline or hanging-man-like candle without a prior "
            "rise is not a confirmed reversal. A supported candle or other measurable "
            "directional clue can justify a low-confidence signal when risk levels are "
            "defensible; do not require multiple clues or pattern confirmation as a gate. "
            "Distinguish measured values from possible interpretations; use UNKNOWN or "
            "unverified when information cannot be established from these inputs. "
            "This is a high-risk trading decision. Do not predict certainty.\n"
            "For SL, place invalidation beyond the closest relevant structural pivot or "
            "pattern invalidation level with a modest ATR/spread-aware buffer, not directly "
            "on the level. The EA keeps a broker-side protective SL even if you are unavailable. "
            "For a BUY use the relevant confirmed swing low/support/base as invalidation; "
            "for a SELL use the confirmed swing high/resistance/retest high. Calculate risk "
            "R from the executable entry quote to this SL in MT5 points. Compare TP1 just "
            "before the nearest meaningful opposing support/resistance zone, TP2 at 2R, "
            "and TP3 just before the next major opposing support/resistance zone, using "
            "repeated swing reactions/touches and supplied higher-timeframe levels when "
            "available. Select one realistic reachable target: favor a clear structural "
            "level, use 2R when there is room, and never force a target through an "
            "intervening opposing level just to achieve 2R. Keep the target outside the "
            "zone with a modest buffer. Distances are from ASK for BUY or BID for SELL. "
            "Read trend from the observed swing sequence: higher highs/higher lows support "
            "bullish structure; lower highs/lower lows support bearish structure. For a "
            "pullback entry, anchor SL beyond the relevant confirmed higher low (BUY) or "
            "lower high (SELL). At a support-bounce BUY, place SL beyond the support zone "
            "or swing low and TP before the next resistance; at a resistance-rejection "
            "SELL, place SL beyond resistance or swing high and TP before the next support. "
            "Do not rely on one candle shape alone: evaluate its prior trend, measured "
            "support/resistance location, and closed-candle confirmation. When a reversal "
            "pattern is objectively confirmed, use the whole pattern extreme for invalidation. "
            "For a double top/bottom or head-and-shoulders pattern, require a measured closed "
            "neckline break; consider the head-to-neckline projection as an additional TP "
            "candidate, capped before intervening opposing structure. For a flag, place SL "
            "beyond the flag structure and consider the flagpole projection only if it is "
            "supported by the supplied candles and not blocked by an opposing zone. For a "
            "breakout/retest, require a shown closed break and retest response; place SL "
            "beyond the retest swing or broken level on the invalidation side. For a "
            "liquidity sweep, require a visible prior high/low to be swept and a close back "
            "across it with directional follow-through; place SL beyond the sweep extreme "
            "and consider the next opposing swing/zone for TP. A sweep alone is not proof "
            "of reversal. Do not invent pattern boundaries, levels, or measured projections. "
            "The EA intentionally swaps your reported exit distances: stop_loss_points "
            "becomes the MT5 TP and take_profit_points becomes the MT5 SL, with no "
            "100-point deduction. Both distances must fit 100-2000 points after mapping. "
            "If a valid structure-based stop and target cannot fit these "
            "limits, do not invent levels. If "
            "exact structure is unclear but ATR and quote are available, estimate "
            "conservative structure-based SL and TP distances only when they remain "
            "anchored to observable price structure, using the nearest closed-candle "
            "extremes and ATR buffer when a clear pivot is unavailable. Prefer a "
            "realistic, unblocked target based on normal structural analysis. This "
            "conventional reward-to-risk assessment does not describe the EA's intentionally "
            "swapped exit distances. If no unblocked structural "
            "target can provide that reward, select the closest reachable target and "
            "reduce confidence. Never tighten the structural SL or invent/stretch a target to meet a ratio. "
            "All distances are MT5 points from the current executable quote (ASK for "
            "BUY, BID for SELL), not pips.\n"
            "Do not calculate or include a confirmation count or mask. Do not require "
            "a named chart pattern, multiple indicator agreement, or higher-timeframe "
            "agreement. First classify the market from the measured swing sequence and "
            "closed prices as trend, range, or transition; identify the strongest "
            "observable M5 setup and its closed-candle trigger; then set SL at the "
            "setup's actual invalidation level and compare reachable, unblocked TP "
            "candidates. Do not count correlated indicators as independent votes, chase "
            "an extended move, or adjust SL/TP just to justify a weak signal. Prefer "
            "always choose BUY or SELL on this flat-account M5 evaluation, even "
            "when the setup is weak, late, or mixed; choose the stronger of the two "
            "directions from the available closed-candle evidence and reduce confidence "
            "rather than returning HOLD. A signal is not a promise of profit. "
            "Return exactly four space-separated tokens and nothing else: "
            "BUY confidence stop_loss_points take_profit_points, "
            "or SELL confidence stop_loss_points take_profit_points. Never return HOLD.\n"
            "Confidence must be an integer from 0 to 100 and describes evidence strength, "
            "not probability. For BUY or SELL, return SL 100-2000 points and TP 200-2000 points. "
            "Estimate the TP from OHLC, candle shape and "
            "sequence, momentum, ATR, trend, and structure. Never omit the protective SL. "
            "No markdown or explanation.\n"
            "EMA20=" + DoubleToString(ema20[0], _Digits) +
            " EMA50=" + DoubleToString(ema50[0], _Digits) +
            " EMA200=" + DoubleToString(ema200[0], _Digits) +
            " RSI14=" + DoubleToString(rsi[0], 2) +
            " RSI14_divergence=" + rsiDivergence +
            " MACD_main=" + DoubleToString(macdMain[0], _Digits) +
            " MACD_signal=" + DoubleToString(macdSignal[0], _Digits) +
            " Momentum14=" + DoubleToString(momentum[0], 2) +
            " ATR14=" + DoubleToString(atr[0], _Digits) + "\n"
            "VWAP_M5_current_server_day=" +
            ((dayVolume > 0) ? DoubleToString(dayVwap, _Digits) : "unavailable") +
            " VWAP_tick_volume=" + (string)dayVolume + "\n"
            "Bollinger20_upper=" + DoubleToString(bandsUpper[0], _Digits) +
            " middle=" + DoubleToString(bandsBase[0], _Digits) +
            " lower=" + DoubleToString(bandsLower[0], _Digits) +
            " width=" + DoubleToString(currentBandWidth, _Digits) +
            " middle_slope_5bars=" + DoubleToString(middleBandSlope, _Digits) +
            " middle_slope_ATR_normalized=" +
            DoubleToString(normalizedMiddleBandSlope, 3) +
            " middle_state=" + middleBandState +
            " squeeze_check=" + squeezeState +
            " current_closed_M5_OHLC=" +
            DoubleToString(rates[copied - 1].open, _Digits) + "," +
            DoubleToString(rates[copied - 1].high, _Digits) + "," +
            DoubleToString(rates[copied - 1].low, _Digits) + "," +
            DoubleToString(signalBarClose, _Digits) +
            " candle_body_fraction=" + DoubleToString(signalBarBodyFraction, 3) +
            " signal_tick_volume=" + DoubleToString(signalBarVolume, 0) +
            " preceding_5_tick_volume_average=" +
            DoubleToString(precedingFiveVolume, 1) + "\n"
            "Stochastic5_3_3_main=" + DoubleToString(stochMain[0], 2) +
            " signal=" + DoubleToString(stochSignal[0], 2) +
            " ADX14=" + DoubleToString(adx[0], 2) +
            " plusDI=" + DoubleToString(plusDi[0], 2) +
            " minusDI=" + DoubleToString(minusDi[0], 2) + "\n"
            "120bar_swing_low=" + DoubleToString(swingLow, _Digits) +
            " high=" + DoubleToString(swingHigh, _Digits) +
            " nearest_M5_pivot_support=" +
            ((nearestM5Support > 0.0) ? DoubleToString(nearestM5Support, _Digits) : "unavailable") +
            " support_pivot_touches=" + (string)m5SupportTouches +
            " nearest_M5_pivot_resistance=" +
            ((nearestM5Resistance > 0.0) ? DoubleToString(nearestM5Resistance, _Digits) : "unavailable") +
            " resistance_pivot_touches=" + (string)m5ResistanceTouches +
            " pivot_cluster_tolerance=" +
            DoubleToString(MathMax(atr[0] * 0.15, _Point * 5.0), _Digits) +
            " sequence=" + fibContext +
            " Fib_retracement_23.6=" + DoubleToString(fib236, _Digits) +
            " 38.2=" + DoubleToString(fib382, _Digits) +
            " 50.0=" + DoubleToString(fib500, _Digits) +
            " 61.8=" + DoubleToString(fib618, _Digits) +
            " Fib_extensions_127.2=" +
            DoubleToString(fibExtension1272, _Digits) +
            " 161.8=" + DoubleToString(fibExtension1618, _Digits) +
            " (60-bar extremes; swing validity unverified)\n"
            "Higher-timeframe supporting context (closed M15/M30/H1 bars and pivot support/resistance; M5 entry remains mandatory):\n" +
            higherTimeframeContext +
            "ExecutableBid=" + DoubleToString(executableBid, _Digits) +
            " ExecutableAsk=" + DoubleToString(executableAsk, _Digits) +
            "PointSize=" + DoubleToString(_Point, _Digits) +
            " Digits=" + (string)_Digits + "\n"
            "SpreadPoints=" + DoubleToString(spreadPoints, 1) +
            "\nRecent closed M5 candle geometry (body/wicks/range in price units, "
            "close location 0=low to 1=high):\n" + recentCandleGeometry +
            "Closed M5 candles oldest to newest (time, open, high, low, close, tick_volume):\n";

   prompt += "\nEXIT MAPPING OVERRIDE: Report your normal analytical distances in the standard four-token format. "
             "The EA intentionally swaps the two distances when submitting the order: your stop_loss_points "
             "value becomes the broker-side MT5 take-profit distance, and your take_profit_points value "
             "becomes the broker-side MT5 stop-loss distance. No 100-point deduction is applied. The EA "
             "validates the resulting MT5 SL against 100-2000 points and MT5 TP against 100-3000 points. "
             "This is an intentional exit reversal requested by the user; do not reverse BUY/SELL direction. "
             "The swapped levels may not match the setup's normal structural invalidation and target; do not "
             "claim they preserve the normal risk/reward plan.\n";

   for(int i = 0; i < copied; i++)
   {
      prompt += TimeToString(rates[i].time, TIME_MINUTES) + "," +
                DoubleToString(rates[i].open, _Digits) + "," +
                DoubleToString(rates[i].high, _Digits) + "," +
                DoubleToString(rates[i].low, _Digits) + "," +
                DoubleToString(rates[i].close, _Digits) + "," +
                (string)rates[i].tick_volume + "\n";
   }
   return true;
}

bool RequestSignal(const string prompt, string &signalText, string &failureReason)
{
   string modelName = InpClaudeModel;
   StringTrimLeft(modelName);
   StringTrimRight(modelName);
   string body = "{\"market_data\":\"" + EscapeJson(prompt) +
                 "\",\"model\":\"" + EscapeJson(modelName) + "\"}";
   char request[];
   int requestLength = StringToCharArray(body, request, 0, WHOLE_ARRAY, CP_UTF8);
   if(requestLength <= 1)
   {
      failureReason = "could not encode the request.";
      Print("Could not encode the Claude signal request.");
      return false;
   }
   ArrayResize(request, requestLength - 1);

   string headers = "Content-Type: application/json\r\n";
   string url = LOCAL_SIGNAL_URL;
   if(InpUseHostedService)
   {
      string anthropicKey = InpAnthropicApiKey;
      StringTrimLeft(anthropicKey);
      StringTrimRight(anthropicKey);
      if(anthropicKey == "")
      {
         failureReason = "enter your Anthropic API key in the EA inputs.";
         Print("Hosted Claude signal request blocked: " + failureReason);
         return false;
      }
      headers += "x-anthropic-api-key: " + anthropicKey + "\r\n";
      url = HOSTED_SIGNAL_URL;
   }
   char response[];
   string responseHeaders;
   ResetLastError();
   int status = WebRequest("POST", url, headers,
                           InpRequestTimeoutMs, request, response, responseHeaders);
   if(status == -1)
   {
      failureReason = StringFormat("WebRequest error %d; check the signal service and MT5 allowed-URL list.",
                                   GetLastError());
      Print("Claude signal WebRequest failed. " + failureReason);
      return false;
   }
   if(status != 200)
   {
      string responseText = CharArrayToString(response, 0, -1, CP_UTF8);
      string apiError;
      if(ExtractJsonString(responseText, "\"error\"", apiError))
         failureReason = StringFormat("signal service HTTP %d: %s", status, StringSubstr(apiError, 0, 180));
      else
         failureReason = StringFormat("signal service HTTP %d; no order will be sent.", status);
      Print("Claude signal request failed: " + failureReason);
      return false;
   }

   string responseText = CharArrayToString(response, 0, -1, CP_UTF8);
   if(!ExtractJsonString(responseText, "\"signal\"", signalText))
   {
      failureReason = "bridge response did not contain a valid signal.";
      Print("Could not read Claude's signal; no order will be sent.");
      return false;
   }
   failureReason = "";
   return true;
}

bool ParseSignal(string signalText, string &action, int &confidence,
                 int &stopLossPoints, int &takeProfitPoints)
{
   StringReplace(signalText, "\r", " ");
   StringReplace(signalText, "\n", " ");
   StringReplace(signalText, "\t", " ");
   StringTrimLeft(signalText);
   StringTrimRight(signalText);

   string fields[];
   ushort separator = StringGetCharacter(" ", 0);
   int count = StringSplit(signalText, separator, fields);
   if(count != 4)
      return false;
   if(fields[0] == "" || fields[1] == "" || fields[2] == "" || fields[3] == "")
      return false;

   action = fields[0];
   StringToUpper(action);
   if(action != "BUY" && action != "SELL" && action != "HOLD")
      return false;
   confidence = (int)StringToInteger(fields[1]);
   stopLossPoints = (int)StringToInteger(fields[2]);
   takeProfitPoints = (int)StringToInteger(fields[3]);
   if(confidence < 0 || confidence > 100 ||
      stopLossPoints < 0 || takeProfitPoints < 0)
      return false;
   if(action == "HOLD")
      return confidence == 0 && stopLossPoints == 0 && takeProfitPoints == 0;
   return confidence > 0 && stopLossPoints > 0 && takeProfitPoints > 0;
}

string EscapeJson(const string value)
{
   string escaped = "";
   for(int i = 0; i < StringLen(value); i++)
   {
      ushort c = StringGetCharacter(value, i);
      if(c == 34) escaped += "\\\"";
      else if(c == 92) escaped += "\\\\";
      else if(c == 8) escaped += "\\b";
      else if(c == 9) escaped += "\\t";
      else if(c == 10) escaped += "\\n";
      else if(c == 12) escaped += "\\f";
      else if(c == 13) escaped += "\\r";
      else if(c < 32) escaped += StringFormat("\\u%04X", c);
      else escaped += ShortToString(c);
   }
   return escaped;
}

bool ExtractJsonString(const string json, const string key, string &value)
{
   int keyPosition = StringFind(json, key);
   if(keyPosition < 0)
      return false;
   int colonPosition = StringFind(json, ":", keyPosition + StringLen(key));
   if(colonPosition < 0)
      return false;

   int start = colonPosition + 1;
   while(start < StringLen(json))
   {
      ushort c = StringGetCharacter(json, start);
      if(c != 32 && c != 9 && c != 10 && c != 13)
         break;
      start++;
   }
   if(start >= StringLen(json) || StringGetCharacter(json, start) != 34)
      return false;

   value = "";
   bool escaped = false;
   for(int i = start + 1; i < StringLen(json); i++)
   {
      ushort c = StringGetCharacter(json, i);
      if(escaped)
      {
         if(c == 110) value += "\n";
         else if(c == 114) value += "\r";
         else if(c == 116) value += "\t";
         else if(c == 98) value += ShortToString(8);
         else if(c == 102) value += ShortToString(12);
         else value += ShortToString(c);
         escaped = false;
      }
      else if(c == 92)
         escaped = true;
      else if(c == 34)
         return true;
      else
         value += ShortToString(c);
   }
   return false;
}

bool ExtractJsonNumber(const string json, const string key, double &value)
{
   int keyPosition = StringFind(json, key);
   if(keyPosition < 0)
      return false;
   int colonPosition = StringFind(json, ":", keyPosition + StringLen(key));
   if(colonPosition < 0)
      return false;

   int start = colonPosition + 1;
   while(start < StringLen(json))
   {
      ushort c = StringGetCharacter(json, start);
      if(c != 32 && c != 9 && c != 10 && c != 13)
         break;
      start++;
   }
   int end = start;
   while(end < StringLen(json))
   {
      ushort c = StringGetCharacter(json, end);
      if((c < 48 || c > 57) && c != 45 && c != 43 && c != 46 && c != 69 && c != 101)
         break;
      end++;
   }
   if(end == start)
      return false;

   value = StringToDouble(StringSubstr(json, start, end - start));
   return MathIsValidNumber(value);
}

string PlaceRiskLimitedOrder(const string action, const int stopLossPoints,
                             const int tradeTakeProfitPoints,
                             const double requestedVolume,
                             bool &executionConfirmed,
                             ulong &dealTicket)
{
   executionConfirmed = false;
   dealTicket = 0;
   if(!InpEnableTrading)
      return "No trade: trading is disabled in EA inputs.";
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ||
      !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
   {
      Print("Trading permission is not enabled; order refused.");
      return "No trade: enable Algo Trading and verify the account allows trading.";
   }
   if(InpEnforceDailyDrawdown && DailyDrawdownLimitReached())
   {
      return "No trade: configured daily drawdown limit has been reached.";
   }
   int openPositions = 0;
   if(!CountOpenPositionsOnAccount(openPositions))
      return "No trade: could not safely check open account positions.";
   if(openPositions >= MAX_OPEN_POSITIONS_PER_ACCOUNT)
      return "No trade: an open account position already exists; the one-position limit is active.";

   if(!CountOpenPositionsOnAccount(openPositions))
      return "No trade: could not safely recheck open account positions.";
   if(openPositions >= MAX_OPEN_POSITIONS_PER_ACCOUNT)
      return "No trade: an open account position appeared before order submission.";

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick) || tick.ask <= 0.0 || tick.bid <= 0.0)
   {
      Print("No valid quote is available after signal analysis; no order sent.");
      return "No trade: MT5 has no valid quote for this symbol.";
   }
   double liveSpreadPoints = (tick.ask - tick.bid) / _Point;
   if(liveSpreadPoints > InpMaxSpreadPoints)
   {
      PrintFormat("Spread %.1f points exceeds the configured maximum of %d; no order sent.",
                  liveSpreadPoints, InpMaxSpreadPoints);
      return StringFormat("No trade: spread is %.1f points, above the configured %d-point maximum.",
                          liveSpreadPoints, InpMaxSpreadPoints);
   }
   ENUM_ORDER_TYPE orderType = (action == "BUY") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double entry = (action == "BUY") ? tick.ask : tick.bid;
   double stopLoss = (action == "BUY")
                     ? entry - stopLossPoints * _Point
                     : entry + stopLossPoints * _Point;
   double takeProfit = (action == "BUY")
                       ? entry + tradeTakeProfitPoints * _Point
                       : entry - tradeTakeProfitPoints * _Point;
   stopLoss = NormalizeDouble(stopLoss, _Digits);
   takeProfit = NormalizeDouble(takeProfit, _Digits);
   if(stopLoss <= 0.0 || takeProfit <= 0.0 ||
      (action == "BUY" && stopLoss >= entry) ||
      (action == "SELL" && stopLoss <= entry) ||
      (action == "BUY" && takeProfit <= entry) ||
      (action == "SELL" && takeProfit >= entry))
   {
      Print("Calculated stop-loss or take-profit is invalid or not favorable; refusing to place the trade.");
      return "No trade: calculated stop-loss or take-profit is invalid.";
   }

   long brokerStopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   int currentSpreadPoints = (int)MathCeil(liveSpreadPoints);
   if(stopLossPoints <= brokerStopsLevel + currentSpreadPoints ||
      tradeTakeProfitPoints <= brokerStopsLevel)
   {
      Print("AI-proposed distances do not satisfy the broker's minimum stop distance.");
      return "No trade: AI stop-loss or take-profit is inside the broker's minimum stop distance.";
   }

   double lossForOneLot = 0.0;
   if(!OrderCalcProfit(orderType, _Symbol, 1.0, entry, stopLoss, lossForOneLot))
   {
      PrintFormat("Could not calculate stop-loss risk (error %d).", GetLastError());
      return "No trade: MT5 could not calculate stop-loss risk.";
   }
   lossForOneLot = MathAbs(lossForOneLot);
   if(lossForOneLot <= 0.0)
   {
      Print("Invalid calculated stop-loss risk; no order sent.");
      return "No trade: calculated stop-loss risk is invalid.";
   }

   double volumeStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minVolume = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxVolume = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(volumeStep <= 0.0 || minVolume <= 0.0 || maxVolume < minVolume)
   {
      Print("Broker volume limits are invalid; no order sent.");
      return "No trade: broker volume limits are unavailable.";
   }
   double maximumRequestedVolume = MathMin(requestedVolume, maxVolume);
   if(maximumRequestedVolume < minVolume)
      maximumRequestedVolume = minVolume;
   double riskCash = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPercent / 100.0;
   if(InpEnforcePerTradeRiskCap)
   {
      double riskLimitedVolume = MathMin(maximumRequestedVolume, riskCash / lossForOneLot);
      if(riskLimitedVolume < minVolume)
      {
         double minimumVolumeRisk = lossForOneLot * minVolume;
         PrintFormat("Broker minimum volume %.8f would risk %.2f, above the %.2f per-trade risk limit; no order sent.",
                     minVolume, minimumVolumeRisk, riskCash);
         return StringFormat("No trade: %s minimum %.2f lots would risk %.2f, above the %.2f per-trade risk cap.",
                             _Symbol, minVolume, minimumVolumeRisk, riskCash);
      }
      maximumRequestedVolume = riskLimitedVolume;
   }
   double volumeSteps = MathFloor((maximumRequestedVolume - minVolume) / volumeStep + 0.0000001);
   double volume = NormalizeDouble(minVolume + volumeSteps * volumeStep, 8);
   double volumeStepCount = (volume - minVolume) / volumeStep;
   if(volume < minVolume || volume > maxVolume ||
      MathAbs(volumeStepCount - MathRound(volumeStepCount)) > 0.0000001)
   {
      PrintFormat("Could not normalize requested volume %.8f to broker limits for %s; no order sent.",
                  requestedVolume, _Symbol);
      return StringFormat("No trade: could not normalize %.2f lots to %s broker volume steps.",
                          requestedVolume, _Symbol);
   }
   double requestedRisk = lossForOneLot * volume;
   if(InpEnforcePerTradeRiskCap && requestedRisk > riskCash + 0.0000001)
   {
      PrintFormat("Normalized volume %.8f risks %.2f, above the %.2f per-trade risk limit; no order sent.",
                  volume, requestedRisk, riskCash);
      return StringFormat("No trade: normalized %.2f lots risks %.2f, above the %.2f per-trade risk cap.",
                          volume, requestedRisk, riskCash);
   }
   if(MathAbs(volume - requestedVolume) > 0.0000001)
   {
      PrintFormat("Requested volume %.8f was adjusted to broker-valid %.8f lots (minimum %.8f, maximum %.8f, step %.8f).",
                  requestedVolume, volume, minVolume, maxVolume, volumeStep);
   }
   if(!InpEnforcePerTradeRiskCap && requestedRisk > riskCash)
      PrintFormat("Estimated stop-loss exposure is %.2f, above the optional per-trade risk amount %.2f; the cap is disabled and the order will proceed only if margin and other checks pass.",
                  requestedRisk, riskCash);

   double requiredMargin = 0.0;
   if(!OrderCalcMargin(orderType, _Symbol, volume, entry, requiredMargin) ||
      requiredMargin > AccountInfoDouble(ACCOUNT_MARGIN_FREE))
   {
      Print("Insufficient free margin or margin calculation failed; no order sent.");
      return "No trade: insufficient free margin or MT5 could not calculate required margin.";
   }

   if(!CountOpenPositionsOnAccount(openPositions))
      return "No trade: could not safely confirm the account is still flat.";
   if(openPositions >= MAX_OPEN_POSITIONS_PER_ACCOUNT)
      return "No trade: another account position opened before order submission.";

   bool sent = (action == "BUY")
               ? trade.Buy(volume, _Symbol, 0.0, stopLoss, takeProfit, "Claude AI M5")
               : trade.Sell(volume, _Symbol, 0.0, stopLoss, takeProfit, "Claude AI M5");
   uint retcode = trade.ResultRetcode();
   if(!sent || (retcode != TRADE_RETCODE_DONE &&
                retcode != TRADE_RETCODE_PLACED &&
                retcode != TRADE_RETCODE_DONE_PARTIAL))
   {
      PrintFormat("Order was rejected: %s (%u).", trade.ResultRetcodeDescription(),
                  retcode);
      return StringFormat("Order rejected by broker: %s (%u).",
                          trade.ResultRetcodeDescription(), retcode);
   }
   dealTicket = trade.ResultDeal();
   executionConfirmed = ((retcode == TRADE_RETCODE_DONE ||
                          retcode == TRADE_RETCODE_DONE_PARTIAL) &&
                         dealTicket > 0);
   PrintFormat("%s order accepted: %.8f lots, SL %.*f, active MT5 TP %d points, broker retcode %u, executed deal %I64u.",
               action, volume, _Digits, stopLoss,
               tradeTakeProfitPoints, retcode, dealTicket);
   string result = StringFormat("%s order accepted: %.2f lots with SL %s; active MT5 TP %d points; broker retcode %u.",
                                action, volume, DoubleToString(stopLoss, _Digits),
                                tradeTakeProfitPoints, retcode);
   result += StringFormat(" Estimated stop-loss exposure %.2f; per-trade risk cap %s.",
                          requestedRisk,
                          InpEnforcePerTradeRiskCap ? "enabled" : "disabled");
   if(retcode == TRADE_RETCODE_PLACED)
      result += " Broker accepted the request but has not confirmed an executed deal; Claude was not called.";
   return result;
}
