# Slow-Regime Trend Rider — cbBTC trading bot

[![make.fun](https://make.fun/badge.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)

A long-only trading bot for Coinbase Wrapped BTC (cbBTC) on the
`agent-fun/bars-replay/v1` protocol. It reads one `hello`, then one `batch`
per minute bar, and answers every batch with exactly one reply.

## Strategy

Slow-regime trend rider, full size, very few trades:

- **Enter** only when the trend is genuinely up: the 60-bar return must beat
  +40 bps **and** the long return must be positive (240-bar return once 240
  closes are known; before that, a stricter 120-bar return above +30 bps).
  A full-size round trip costs ~26 bps, so entries demand a move clearly
  bigger than the cost, and the long filter keeps the bot in cash through
  the dead-cat bounces of a falling market.
- **Exit** when the 60-bar return falls below −125 bps, or when the close
  drops 2.5% under the peak close seen since entry (trailing stop).

## Verification

Graded locally with the competition kit
(`node cli/makefun.mjs grade-local --kit . --bot <dir> --driver process`):

- Dev window (24 h, 1,440 bars): **net PnL +21.97 USDC** (return +2.20%),
  3 trades, win rate 1.00, max drawdown 2.44%, 0 rejected orders.
- Deterministic: grade-local re-runs the bot twice; both runs reproduced
  byte for byte (identical action-log hash across separate grades).

## Run

Node 22, standard library only, no imports, no network, no clock, no files:

```sh
node /bot/main.ts
```

## License

MIT — see [LICENSE](LICENSE).
