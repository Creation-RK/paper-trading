# Paper Scalper

A trading app designed as a game, inspired by the SAHI trading app, for practising on almost-live markets.

Every day the app replays the **previous trading day's NIFTY 50 and Crude Oil sessions** minute by minute in an Options Scalper screen. You run three trader profiles, and each one takes **one entry and one exit (a CALL or a PUT) in each subject**, using its own customisable system of indicators and rules. Finished trades are scored and land on the scorecard.

## How a day plays

1. **Create three profiles** (Profiles tab). Each starts with ₹1,00,000 of virtual capital and the default *ORB + VWAP Scalper* system: Ultimate RSI, VWAP (Session), EMA (7) and ORB.
2. **Pick the day** on the Play tab. Yesterday's session is the daily game, and the last five trading days can be caught up on.
3. **Replay a subject.** Candles appear one minute at a time (1x to 60x speed, step +1 min, skip +15 min). Future candles stay hidden, and you cannot rewind.
   - View it on 1, 3, 5, 15, 25, 75 or 125-minute candles, as **candlesticks, Heikin Ashi or a wave (line) chart**.
   - The previous two sessions sit to the left of the open, so indicators are warmed up at 09:15.
   - The **CALL setup / PUT setup** chips show live which of the active profile's conditions are met.
4. **Trade from the Options Scalper panel.** Pick the active profile, then BUY CALL or BUY PUT at the ATM strike, or any strike from the option chain. Each profile gets one slot per subject per day:
   - The stop-loss and target from the profile's exit plan are checked against every minute's high and low.
   - Open positions are squared off automatically 10 minutes before the close (15:20 for NIFTY, 23:20 for crude), and no new entries are allowed after that.
5. **Finish the day** to see the results: each profile's P&L, points, and how much of the day's best possible option move it caught.

### Scoring

| | Points |
|---|---|
| Net return on the premium paid (after ₹20 per order) | 1 point per 1%, from −100 to +300 |
| Entry taken while the profile's own setup was live | +10 |
| Entry taken while the *opposite* setup was live | −5 |
| Exit by the plan (stop-loss or target hit) | +5 |
| No trade in a slot | 0 |

The day grade (S, A, B, C, D, F) is the average points per profile. The scorecard has a leaderboard plus each profile's balance, win rate, average return, discipline (the share of entries taken on signal), win streak, best and worst trade, balance curve, a breakdown by subject, and a trade journal.

## Customising a system

Profiles → **Customise system** opens the editor (the *Added indicators* list from SAHI, with remove and edit buttons):

- **Signal timeframe**: the candle size the rules are checked on.
- **Indicators** (each with editable parameters and colours): EMA, SMA, VWAP (Session), ORB, Supertrend, Bollinger Bands, Ultimate RSI (LuxAlgo formula), RSI and MACD.
- **CALL and PUT conditions**: rules such as *Price crosses above ORB High* or *Ultimate RSI is above 50*. Price, any indicator output or a number can be compared using *is above*, *is below*, *crosses above* or *crosses below*. A setup is live when all of its conditions hold.
- **Exit plan**: lots per trade, plus stop-loss % and target % of the premium.
- **Trading plan**: free-text notes, shown in the session.

## Market data

`scripts/fetch-session.mjs` downloads 1-minute bars from Yahoo Finance's public chart API and writes `public/data/sessions/<date>/<SYMBOL>.json` along with `public/data/index.json`. The **Fetch market data** GitHub Action runs it at 07:00 IST from Tuesday to Saturday and commits the result, so the app always has yesterday's sessions. It keeps 30 days of data.

| Subject | Source | Option IV |
|---|---|---|
| NIFTY 50 | `^NSEI` (NSE index) | India VIX |
| Crude Oil | `CL=F` (NYMEX WTI) × `INR=X`, in ₹/bbl, as a stand-in for NSE/MCX crude | CBOE OVX |

Limitations:

- **Days without fetched data** replay a *simulated* session, which is clearly labelled in the app. Simulated sessions are generated from a seed per date, so a day is the same on every device.
- **Option premiums are theoretical** (Black-Scholes on the replayed spot, using that day's IV, with NIFTY weekly expiry on Tuesday and crude monthly expiry around the 17th). Historical option chains aren't freely available.
- **The NIFTY index has no volume**, so VWAP weights every minute equally for it.
- **Festival holidays** move every year. Add them to `EXTRA_HOLIDAYS` in `src/lib/calendar.ts`. Any day with fetched data always counts as a trading day.

To fetch data by hand, run `npm run fetch:data`. This needs internet access to `query1.finance.yahoo.com`.

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # unit tests (indicators, options, scoring, replay, data files)
npm run build          # static site in dist/; host it anywhere (GitHub Pages, Netlify, Cloudflare Pages)
npm run build:artifact # one self-contained HTML file in dist-artifact/
```

On a phone, open the hosted site and choose **Add to Home Screen**. It installs as an app (PWA) and works offline. Progress is saved on the device.

### GitHub Pages

The site is served from the `gh-pages` branch at `https://creation-rk.github.io/paper-trading/`. The **Deploy to GitHub Pages** workflow rebuilds it on every push to `main` and after each daily market-data fetch, so new sessions go live automatically.

One-time setup in the repository's **Settings → Pages**: set **Source** to *Deploy from a branch*, then pick `gh-pages` and `/ (root)`. GitHub Pages needs a public repository, or a paid plan (Pro, Team or Enterprise) for a private one. A Pages site is public even when the repository is private.

## Project layout

```
src/lib/            game logic, no UI
  instruments.ts    subjects: session hours, lot size, strike step, expiry rule
  market/           data loading, simulated sessions, candle aggregation
  indicators/       indicator maths and registry
  system.ts         systems, rules and setup evaluation
  options.ts        Black-Scholes pricing, ATM strike, expiry
  replay.ts         stop-loss, target and square-off checks
  scoring.ts        P&L, points, best possible move, profile stats
src/screens/        Home, Profiles, SystemEditor, Session (Options Scalper), Scorecard
src/store/game.ts   persisted state: profiles, replay progress, trades
scripts/            market-data fetcher and single-file build
```

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for V2 (multiple systems, three more subjects) and V3 (templates, five more subjects, levels, weekly feedback and monthly reports).
