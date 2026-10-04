import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCandles, fisherState, calculateFisher, ACTIONS, orderRoles, groupActionLabel } from '../research.mjs';

test('OHLC and market volume are conserved when changing timeframe', () => {
  assert.deepEqual(aggregateCandles([[0, 10, 14, 8, 12, 7], [60, 12, 16, 11, 15, 9], [300, 15, 17, 13, 14, 5]], 300),
    [{ b: 0, o: 10, h: 16, l: 8, c: 15, v: 16 }, { b: 300, o: 15, h: 17, l: 13, c: 14, v: 5 }]);
  assert.equal(aggregateCandles([[0, 10, 14, 8, 12], [60, 12, 16, 11, 15, 9]], 300)[0].v, null);
});

test('Fisher recursion matches independently calculated rising-price values', () => {
  const rows = calculateFisher([10, 11, 12].map((p, i) => ({ b: i * 60, h: p, l: p })));
  const f1 = Math.atanh(0.33);
  const f2 = Math.atanh(0.33 + 0.67 * 0.33) + 0.5 * f1;
  assert.equal(rows[0][1], 0);
  assert.ok(Math.abs(rows[1][1] - f1) < 1e-12);
  assert.ok(Math.abs(rows[2][1] - f2) < 1e-12);
  assert.equal(rows[2][2], rows[1][1]);
});

test('monthly chunking preserves the same Fisher history as one continuous run', () => {
  const bars = Array.from({ length: 80 }, (_, i) => ({ b: i * 86400, h: 100 + Math.sin(i) * 9, l: 98 + Math.sin(i) * 9 }));
  const state = fisherState(9);
  assert.deepEqual([...calculateFisher(bars.slice(0, 31), state), ...calculateFisher(bars.slice(31), state)], calculateFisher(bars));
  const window = fisherState(9);
  calculateFisher(bars, window);
  assert.equal(window.prices.length, 9);
});

test('flat windows and prolonged extremes stay finite', () => {
  const flat = calculateFisher(Array.from({ length: 20 }, (_, i) => ({ b: i, h: 10, l: 10 })));
  assert.ok(flat.every((row) => row[1] === 0 && row[2] === 0));
  const rising = calculateFisher(Array.from({ length: 1000 }, (_, i) => ({ b: i, h: i + 1, l: i })));
  assert.ok(rising.every((row) => Number.isFinite(row[1])));
});

test('sell-to-reduce-long and buy-to-reduce-short keep their position direction', () => {
  assert.equal(ACTIONS[2].direction, 1);
  assert.equal(ACTIONS[4].direction, -1);
  const roles = orderRoles([[0, 100, 5, 2, 0, 1], [1, 100, 5, 4, 0, 2], [2, 100, 5, 2, 0, 3], [3, 100, 5, 3, 0, 3]]);
  assert.equal(roles.get(1).label, 'Long 축소/종료');
  assert.equal(roles.get(2).label, 'Short 축소/종료');
  assert.equal(roles.get(3).color, 'mixed');
  assert.equal(roles.get(3).label, 'Long 축소/종료 · Short 진입/추가');
});

test('feed distinguishes entry, add, reduce, exit, and forced liquidation', () => {
  const episode = [0, 100, 200, -1];
  assert.equal(groupActionLabel({ inc: true, t0: 100 }, episode), 'Short 진입');
  assert.equal(groupActionLabel({ inc: true, t0: 110 }, episode), 'Short 추가');
  assert.equal(groupActionLabel({ inc: false, pos: -10 }, episode), 'Short 축소');
  assert.equal(groupActionLabel({ inc: false, pos: 0 }, episode), 'Short 종료');
  assert.equal(groupActionLabel({ liq: true }, episode), 'Short 강제청산');
});
