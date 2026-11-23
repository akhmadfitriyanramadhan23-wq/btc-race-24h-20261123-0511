// Slow-regime trend rider for cbBTC on the agent-fun/bars-replay/v1 protocol.
//
// The bot reads one hello, then one batch per minute bar, and answers every
// batch with exactly one reply echoing its seq. Orders decided on the batch
// of the bar that closes at minute t fill at the open of the next bar.
//
// Strategy (long only, one position, full size, very few trades):
//   * Stay flat until the trend is genuinely up: the 60-bar return must beat
//     +40 bps AND the long return must be positive (240-bar return once 240
//     closes are known; before that, a stricter 120-bar return above +30 bps).
//     A full-size round trip costs ~26 bps, so entries demand a move clearly
//     bigger than the cost, and the long filter keeps the bot in cash through
//     the dead-cat bounces of a falling market.
//   * While long, exit when the 60-bar return falls below -125 bps, or when
//     the latest close drops 2.5% under the peak close seen since entry (a
//     trailing stop that only bites in a real slide, capping drawdown).
//   * No randomness, no clock, no files, no network: every decision is pure
//     integer arithmetic on the closes carried in the batches, so two runs on
//     the same data produce byte-identical orders.
//
// Runs on Node 22 with type stripping: erasable syntax only, no imports.

const SYMBOL = "CBBTC";

// Entry: 60-bar return must exceed this (basis points).
const ENTER_SHORT_BPS = 40;
// Entry before 240 bars of history: 120-bar return must exceed this.
const ENTER_EARLY_BPS = 30;
// Exit: 60-bar return below this (basis points) means the trend broke.
const EXIT_SHORT_BPS = -125;
// Exit: close this far under the peak close since entry (basis points).
const TRAIL_BPS = 250;

const SHORT_WINDOW = 60;
const LONG_WINDOW = 240;
const EARLY_WINDOW = 120;

const BUY_SLIPPAGE_BPS = 200;
const SELL_SLIPPAGE_BPS = 500;

/** Return from `then` to `now` in basis points, integer arithmetic. */
function retBps(now: number, then: number): number {
  if (then <= 0) return 0;
  return Math.trunc(((now - then) * 10000) / then);
}

type Order =
  | {
      side: "buy";
      client_id: string;
      symbol: string;
      notional_quote_units: string;
      max_slippage_bps: number;
    }
  | {
      side: "sell";
      client_id: string;
      symbol: string;
      qty: string;
      max_slippage_bps: number;
    };

async function main(): Promise<void> {
  const closes: number[] = []; // closes of CBBTC, raw price units, oldest first
  let cash = 0; // quote units (micro-USDC)
  let positionQty = 0; // base units of CBBTC held
  let warmupBars = 0;
  let orderNo = 0;
  let peakSinceEntry = 0; // highest close seen while holding, raw price units

  let buf = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line === "") continue;
      const msg = JSON.parse(line) as Record<string, unknown>;
      const kind = msg["type"];

      if (kind === "hello") {
        warmupBars = Number(msg["warmup_bars"] ?? 0);
        const capital = msg["capital"] as Record<string, unknown>;
        cash = Number(capital["quote_units"]);
        continue;
      }

      if (kind === "done") {
        return;
      }

      if (kind !== "batch") continue;

      const seq = Number(msg["seq"]);
      const orders: Order[] = [];

      const bars = (msg["bars"] as Array<Record<string, unknown>>) ?? [];
      let freshBar = false;
      for (const bar of bars) {
        if (bar["symbol"] === SYMBOL) {
          closes.push(Number(bar["c"]));
          freshBar = true;
        }
      }

      const account = (msg["account"] as Record<string, unknown>) ?? {};
      cash = Number(account["cash_quote_units"] ?? 0);
      positionQty = 0;
      const positions =
        (account["positions"] as Array<Record<string, unknown>>) ?? [];
      for (const pos of positions) {
        if (pos["symbol"] === SYMBOL) positionQty = Number(pos["qty"]);
      }

      const latest = closes.length > 0 ? closes[closes.length - 1] : 0;
      if (latest > 0) {
        if (positionQty > 0) {
          if (latest > peakSinceEntry) peakSinceEntry = latest;
        } else {
          peakSinceEntry = 0;
        }
      }

      const warmingUp = warmupBars > 0 && seq < warmupBars;
      const n = closes.length;

      // Decide only on a batch that carried a fresh bar for the symbol:
      // on a gap minute the closes are stale and re-deciding could repeat
      // an entry the previous bar already acted on.
      if (!warmingUp && freshBar && n > SHORT_WINDOW && latest > 0) {
        const shortRet = retBps(latest, closes[n - 1 - SHORT_WINDOW]);
        if (positionQty === 0) {
          // Enter only on a confirmed uptrend at both horizons.
          let longOk = false;
          if (n > LONG_WINDOW) {
            longOk = retBps(latest, closes[n - 1 - LONG_WINDOW]) > 0;
          } else if (n > EARLY_WINDOW) {
            longOk =
              retBps(latest, closes[n - 1 - EARLY_WINDOW]) >
                ENTER_EARLY_BPS && shortRet > ENTER_EARLY_BPS;
          }
          if (longOk && shortRet > ENTER_SHORT_BPS && cash > 0) {
            orderNo += 1;
            orders.push({
              side: "buy",
              client_id: "b" + orderNo,
              symbol: SYMBOL,
              notional_quote_units: String(cash),
              max_slippage_bps: BUY_SLIPPAGE_BPS,
            });
          }
        } else {
          // Exit on trend break or on a slide from the entry peak.
          const trailHit =
            peakSinceEntry > 0 &&
            retBps(latest, peakSinceEntry) <= -TRAIL_BPS;
          if (shortRet < EXIT_SHORT_BPS || trailHit) {
            orderNo += 1;
            orders.push({
              side: "sell",
              client_id: "s" + orderNo,
              symbol: SYMBOL,
              qty: String(positionQty),
              max_slippage_bps: SELL_SLIPPAGE_BPS,
            });
          }
        }
      }

      process.stdout.write(
        JSON.stringify({ type: "reply", seq, orders }) + "\n",
      );
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
