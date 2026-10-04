// Fisher Transform (HL2, length 9), with a one-bar delayed trigger.
// Recursive state is carried across monthly files by the static build.
export const TIMEFRAMES = [60, 300, 1800, 3600, 14400, 86400];
export const ACTIONS = {
  1: { side: 'buy', inc: true, direction: 1, color: 'buy', name: 'Long 진입/추가' },
  2: { side: 'sell', inc: false, direction: 1, color: 'buy', name: 'Long 축소/종료' },
  3: { side: 'sell', inc: true, direction: -1, color: 'sell', name: 'Short 진입/추가' },
  4: { side: 'buy', inc: false, direction: -1, color: 'sell', name: 'Short 축소/종료' },
};
export const directionColor = (direction) => direction > 0 ? 'buy' : direction < 0 ? 'sell' : 'mixed';

export function aggregateCandles(candles, timeframe) {
  const out = [];
  let bar = null;
  for (const [t, o, h, l, c, v] of candles) {
    const b = Math.floor(t / timeframe) * timeframe;
    const volume = Number.isFinite(v) ? v : null;
    if (!bar || bar.b !== b) {
      bar = { b, o, h, l, c, v: volume };
      out.push(bar);
    } else {
      bar.h = Math.max(bar.h, h); bar.l = Math.min(bar.l, l); bar.c = c;
      bar.v = bar.v === null || volume === null ? null : bar.v + volume;
    }
  }
  return out;
}

export function fisherState(length = 9) {
  return { length, prices: [], normalized: 0, fisher: 0 };
}

export function calculateFisher(bars, state = fisherState()) {
  return bars.map((bar) => {
    const price = (bar.h + bar.l) / 2;
    state.prices.push(price);
    if (state.prices.length > state.length) state.prices.shift();
    const high = Math.max(...state.prices), low = Math.min(...state.prices);
    // A flat window has no relative price displacement; use its neutral midpoint.
    const displacement = high === low ? 0 : (price - low) / (high - low) - 0.5;
    let value = 0.66 * displacement + 0.67 * state.normalized;
    value = value > 0.99 ? 0.999 : value < -0.99 ? -0.999 : value;
    const trigger = state.fisher;
    state.normalized = value;
    state.fisher = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * trigger;
    return [bar.b, state.fisher, trigger];
  });
}

export function groupActionLabel(group, episode) {
  const direction = episode[3] > 0 ? 'Long' : 'Short';
  if (group.liq) return `${direction} 강제청산`;
  if (group.inc) return `${direction} ${group.t0 === episode[1] ? '진입' : '추가'}`;
  const closed = group.pos === 0 || Math.sign(group.pos) !== episode[3];
  return `${direction} ${closed ? '종료' : '축소'}`;
}

export function orderRoles(fills) {
  const orders = new Map();
  for (const fill of fills) {
    const action = ACTIONS[fill[3]];
    if (!action) throw new Error(`Unknown position action: ${fill[3]}`);
    let order = orders.get(fill[5]);
    if (!order) orders.set(fill[5], order = { actions: new Set(), directions: new Set() });
    order.actions.add(fill[3]); order.directions.add(action.direction);
  }
  return new Map([...orders].map(([id, order]) => {
    const direction = order.directions.size === 1 ? [...order.directions][0] : 0;
    return [id, { direction, color: directionColor(direction), label: [...order.actions].map((code) => ACTIONS[code].name).join(' · ') }];
  }));
}
