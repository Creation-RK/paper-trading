# Roadmap

## V1 (this release)

- Replay of yesterday's NIFTY 50 and Crude Oil sessions, minute by minute, on 1 to 125-minute candles as candlesticks, Heikin Ashi or a wave chart.
- Options Scalper screen: ATM or option-chain strikes, live premiums, stop-loss and target, auto square-off.
- Three player profiles, each with one entry and one exit (CALL or PUT) per subject per day.
- One customisable system per profile: indicators, CALL/PUT conditions, exit plan, notes.
- Scorecard: points, leaderboard, stats, balance curve, trade journal, day grades.
- A daily market-data fetch, with a labelled simulated fallback.

## V2

| Feature | Where it plugs in |
|---|---|
| **Choose from multiple systems.** A library of ready-made systems (ORB + VWAP, Supertrend trend-follower, RSI mean reversion, Bollinger squeeze) that a profile can pick from or copy. | A `SystemDef[]` library next to `defaultSystem()` in `src/lib/system.ts`, plus a picker in `SystemEditor.tsx`. Profiles already store a full `SystemDef`. |
| **Three more subjects** (for example BANK NIFTY, SENSEX, Natural Gas). | One entry each in `INSTRUMENTS` (`src/lib/instruments.ts`) and in `SUBJECTS` (`scripts/fetch-session.mjs`). The home screen, replay, scoring and scorecard read from the registry. |

## V3

| Feature | Where it plugs in |
|---|---|
| **Customisable templates.** Save any system as a named template and apply it to any profile ("Save as template" in the indicators sheet). | Templates are `SystemDef`s stored in the game store. Copying gives indicators new ids; `pruneRules` already keeps rules consistent. |
| **Five more subjects.** | Same registry as V2. |
| **Levels.** Unlock speeds, subjects or capital as points accumulate. | `profileStats().points` already sums lifetime points per profile. |
| **Weekly feedback and monthly reports.** | The trade journal stores entry signal match, exit reason and capture of the best move for every trade. The scorecard's notes (`coachNotes`) are the first step: group them by ISO week or month and add a report screen. |
