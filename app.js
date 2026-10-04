import { ACTIONS, aggregateCandles, directionColor, groupActionLabel, orderRoles } from './research.mjs';
'use strict';
/* 워뇨띠(aoa) 체결 분석 뷰어
 * 데이터: data/wallet.js, data/index.js, data/episodes.js (항상), data/f_YYYY-MM.js · data/c_YYYY-MM.js (달마다 필요할 때)
 * 시간: 파일은 UTC 초, 화면은 +9시간(KST)으로 밀어서 표시한다.
 */
const LW = LightweightCharts;
const KST = 9 * 3600;
const W = window.__data.wallet;
const IDX = window.__data.index;
const E = window.__data.episodes;
const NOTES = window.__data.notes || {};
const EXPL = window.__data.expl || {}; // 빌드에서 미리 만든 해설 (scripts/build_commentary.py)
const $ = (s) => document.querySelector(s);

// 주문: [side, ordtype, price, pmin, pmax, orderqty, filled, leaves, first, last, flags, stoppx]
// 체결: [t, px, qty, act, taker, orderIdx, posAfter, fee, episodeId]
// 라운드트립: [id, start, end|null, dir, maxpos, entryOrders, levels, entrySpanSec, priceRangePct, exitOrders, pnl, liq, takerPct, entryVwap, exitVwap,
//            lev(잔고 대비 배수|null), balBtc(시작 전날 잔고|null), retPct(손익/잔고 %|null), fundingPnl(BTC), feePnl(BTC)]
const netPnl = (e) => e[10] + e[18] + e[19];
const ACT = ACTIONS;
const RGB = { buy: '38,166,154', sell: '239,83,80', mixed: '240,180,41' };
const FLAGS = [[8, '강제청산', 'liq'], [2, '스탑 발동'], [4, '포지션 청산 버튼'], [1, '주문 수정됨'], [16, 'Post-only'], [32, 'Close 전용']];
const ORDTYPE = { Limit: '지정가', Market: '시장가', Stop: '스탑(시장가)', StopLimit: '스탑 지정가' };
const TFS = [60, 300, 1800, 3600, 14400, 86400];
const TF_NAME = { 60: '1분', 300: '5분', 1800: '30분', 3600: '1시간', 14400: '4시간', 86400: '1일' };

/* ---------- 공통 ---------- */
const store = {
  get(k, d) {
    try { const v = localStorage.getItem('aoa.' + k); return v === null ? d : JSON.parse(v); }
    catch (e) { console.warn('localStorage 읽기 실패', e); return d; }
  },
  set(k, v) {
    try { localStorage.setItem('aoa.' + k, JSON.stringify(v)); }
    catch (e) { console.warn('localStorage 쓰기 실패', e); }
  },
};
const nf = (n, d = 0) => Number(n).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
function usd(n) {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e8) return s + nf(a / 1e8, 2) + '억$';
  if (a >= 1e4) return s + nf(a / 1e4, a >= 1e6 ? 0 : 1) + '만$';
  return s + nf(a) + '$';
}
const btc = (n, d = 2, sign = false) => (sign && n > 0 ? '+' : '') + nf(n, d) + ' BTC';
function kst(t, sec = true) {
  const s = new Date((t + KST) * 1000).toISOString();
  return s.slice(0, 10) + ' ' + s.slice(11, sec ? 19 : 16);
}
const hm = (t) => kst(t, false).slice(11);
const md = (t) => kst(t, false).slice(5);
const monthOf = (t) => new Date(t * 1000).toISOString().slice(0, 7);
function dur(sec) {
  if (sec < 60) return `${Math.round(sec)}초`;
  if (sec < 3600) return `${(sec / 60).toFixed(sec < 600 ? 1 : 0)}분`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}시간`;
  return `${(sec / 86400).toFixed(1)}일`;
}
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dirTag = (dir) => (dir > 0 ? '<span class="tag buy">Long</span>' : '<span class="tag sell">Short</span>');
function lowerBound(arr, t) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m][0] < t) lo = m + 1; else hi = m; }
  return lo;
}
const baseOpts = () => ({
  autoSize: true,
  layout: { background: { type: 'solid', color: '#0e1116' }, textColor: '#8b95a3', fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'),
    panes: { separatorColor: '#1c2128', separatorHoverColor: 'rgba(88,166,255,.25)', enableResize: true } },
  grid: { vertLines: { color: '#161b22' }, horzLines: { color: '#161b22' } },
  rightPriceScale: { borderColor: '#1c2128' },
  leftPriceScale: { borderColor: '#1c2128' },
  timeScale: { borderColor: '#1c2128' },
  crosshair: { mode: LW.CrosshairMode.Normal, vertLine: { color: '#2a313a', labelBackgroundColor: '#1c2128' }, horzLine: { color: '#2a313a', labelBackgroundColor: '#1c2128' } },
});
const loadedScripts = {};
function loadData(key) {
  if (window.__data[key]) return Promise.resolve(window.__data[key]);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `data/${key}.js`;
    s.onload = () => (window.__data[key] ? resolve(window.__data[key]) : reject(new Error(`data/${key}.js 형식 오류`)));
    s.onerror = () => { s.remove(); reject(new Error(`data/${key}.js 파일이 없습니다`)); };
    loadedScripts[key] = s;
    document.head.appendChild(s);
  });
}
function unloadExcept(keep) {
  for (const k of Object.keys(loadedScripts)) {
    if (keep.includes(k)) continue;
    loadedScripts[k].remove(); delete loadedScripts[k]; delete window.__data[k];
  }
}
function sortableTable(table, rows, cols, render, onClick, defaultSort) {
  // cols: [{key, label, num}], rows: 객체 배열. 열 제목 클릭 정렬.
  let sortKey = defaultSort?.key ?? cols[0].key, sortDir = defaultSort?.dir ?? 1;
  const draw = () => {
    const sorted = [...rows].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
      return r * sortDir;
    });
    table.innerHTML = `<thead><tr>${cols.map((c) => `<th data-k="${c.key}" class="${c.key === sortKey ? 'sorted' : ''}">${c.label}${c.key === sortKey ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead><tbody>${sorted.map(render).join('')}</tbody>`;
  };
  table.onclick = (e) => {
    const th = e.target.closest('th[data-k]');
    if (th) { if (sortKey === th.dataset.k) sortDir = -sortDir; else { sortKey = th.dataset.k; sortDir = 1; } draw(); return; }
    const tr = e.target.closest('tr[data-id]');
    if (tr && onClick) onClick(tr.dataset.id, tr);
  };
  draw();
}

/* ---------- 상태 · 탭 ---------- */
const peakDay = W.days.reduce((a, d) => (d[1] > a[1] ? d : a));
const state = {
  view: 'balance',
  month: store.get('month', peakDay[0].slice(0, 7)),
  tf: store.get('tf', 3600),
  ep: null, pendingEp: null,
  filter: 'all',
  showFills: true, showOrders: true, showLadder: true, showPos: true, showEps: true,
  showVolume: true, showFisher: true,
  ptab: store.get('ptab', 'expl'),
};
function readHash() {
  const [v, m, tf, ep] = location.hash.replace('#', '').split('/');
  if (v === 'balance' || v === 'fills' || v === 'hypo') state.view = v;
  if (m && IDX.some((x) => x.month === m)) state.month = m;
  if (tf && TF_NAME[tf]) state.tf = Number(tf);
  if (ep && /^ep\d+$/.test(ep)) state.pendingEp = Number(ep.slice(2));
}
function saveHash() {
  const h = state.view === 'fills' ? `#fills/${state.month}/${state.tf}${state.ep != null ? '/ep' + state.ep : ''}` : '#' + state.view;
  history.replaceState(null, '', h);
  store.set('month', state.month); store.set('tf', state.tf);
}
function showView(v) {
  state.view = v;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === 'view-' + v));
  saveHash();
  window.scrollTo({ top: 0 });
  if (v === 'balance') ensureBalance(); else if (v === 'hypo') ensureHypo(); else ensureFills();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
function segInit(el, value, onChange) {
  const btns = el.querySelectorAll('button');
  const mark = (v) => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
  mark(value);
  btns.forEach((b) => b.addEventListener('click', () => { if (b.disabled) return; mark(b.dataset.v); onChange(b.dataset.v); }));
  return mark;
}
/* ---------- 차트를 끌지 않고 움직이기 ---------- */
// 휠 가드: 세로 휠 = 페이지 스크롤(차트로 안 보냄) · 가로 스와이프 = 좌우 이동 · 핀치 / ⌘·⌥+휠 = 확대·축소
function wheelGuard(el) {
  el.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (Math.abs(e.deltaX) > 2 * Math.abs(e.deltaY)) return;
    e.stopPropagation();
  }, { capture: true });
}
// 이동 막대: 버튼(« ‹ − 전체 + › ») + 미니맵(전체 흐름 위에 지금 보이는 구간 = 노란 창, 누르거나 끌면 그 위치로)
// src: { n(): 시간축 점 개수, values(): 미니맵 값 배열, ticks(): [{i, text, minor}], marks?(): [{i0, i1, color}], fit?(), onNav?() }
function makeNav(el, chart, src) {
  el.innerHTML = `<span class="seg nav-btns">
      <button data-a="start" title="처음으로">«</button><button data-a="left" title="왼쪽으로 반 화면 (←)">‹</button>
      <button data-a="out" title="넓게 보기 (−)">−</button><button data-a="fit" title="전체 보기 (0)">전체</button><button data-a="in" title="좁게 보기 (+)">+</button>
      <button data-a="right" title="오른쪽으로 반 화면 (→)">›</button><button data-a="end" title="끝으로">»</button></span>
    <canvas class="nav-map" title="누르거나 끌면 그 위치로 이동"></canvas>
    <span class="nav-hint">← → 이동 · + − 확대 · 0 전체</span>`;
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d'), ts = chart.timeScale();
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono');
  let vals = [], ticks = [], raf = 0, dragging = false;
  const setCenter = (c, w) => {
    const n = src.n(); if (!n) return;
    c = w >= n ? (n - 1) / 2 : Math.min(Math.max(c, w / 2 - 1), n - w / 2 + 2);
    ts.setVisibleLogicalRange({ from: c - w / 2, to: c + w / 2 });
  };
  const act = (a) => {
    const r = ts.getVisibleLogicalRange(), n = src.n();
    if (!r || !n) return;
    if (a === 'fit') { if (src.fit) src.fit(); else ts.fitContent(); return; }
    const w = r.to - r.from, c = (r.from + r.to) / 2;
    if (a === 'left') setCenter(c - w / 2, w);
    else if (a === 'right') setCenter(c + w / 2, w);
    else if (a === 'in') setCenter(c, Math.max(w * 0.6, 8));
    else if (a === 'out') { if (src.zoomOut && src.zoomOut(c, w / 0.6)) return; setCenter(c, Math.min(w / 0.6, n + 4)); }
    else if (a === 'start') setCenter(0, w);
    else if (a === 'end') setCenter(n, w);
    src.onNav?.();
  };
  const draw = () => {
    raf = 0;
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const n = src.n(); if (n < 2 || !vals.length) return;
    const X = (i) => 2 + (i / (n - 1)) * (w - 4), top = 3, bot = h - 12;
    // 눈금 (아래 12px = 글자 줄)
    ctx.font = `9.5px ${mono}`; ctx.lineWidth = 1; let lastX = -99;
    for (const t of ticks) {
      const x = Math.round(X(t.i)) + 0.5;
      ctx.strokeStyle = t.minor ? 'rgba(139,149,163,.10)' : 'rgba(139,149,163,.28)';
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
      if (t.text && x - lastX >= 22) { ctx.fillStyle = '#5c6672'; ctx.fillText(t.text, x + 2, h - 2); lastX = x; }
    }
    for (const m of src.marks ? src.marks() : []) { ctx.fillStyle = m.color; ctx.fillRect(X(m.i0), top, Math.max(X(m.i1) - X(m.i0), 2), bot - top); }
    // 값: 픽셀 열마다 최저~최고 (1분봉 수만 개도 가볍게)
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const Y = (v) => bot - 1 - ((v - lo) / (hi - lo || 1)) * (bot - top - 3);
    const cols = Math.ceil(w), mn = new Float64Array(cols).fill(Infinity), mx = new Float64Array(cols).fill(-Infinity);
    for (let i = 0; i < n; i++) {
      const v = vals[i]; if (v == null) continue;
      const c = Math.min(cols - 1, Math.max(0, Math.floor(X(i))));
      if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v;
    }
    ctx.strokeStyle = 'rgba(200,208,218,.75)'; ctx.beginPath(); let started = false;
    for (let c = 0; c < cols; c++) {
      if (mn[c] === Infinity) continue;
      const y1 = Y(mx[c]), y2 = Y(mn[c]);
      if (!started) { ctx.moveTo(c + 0.5, y1); started = true; } else ctx.lineTo(c + 0.5, y1);
      if (y2 - y1 > 1) ctx.lineTo(c + 0.5, y2);
    }
    ctx.stroke();
    // 지금 보이는 구간
    const r = ts.getVisibleLogicalRange();
    if (r) {
      const x0 = Math.max(0, X(r.from)), x1 = Math.min(w, X(r.to)), ww = Math.max(x1 - x0, 4);
      ctx.fillStyle = 'rgba(7,9,11,.55)'; ctx.fillRect(0, 0, x0, h); ctx.fillRect(x0 + ww, 0, w - x0 - ww, h);
      ctx.fillStyle = 'rgba(240,180,41,.12)'; ctx.fillRect(x0, 0, ww, h);
      ctx.strokeStyle = 'rgba(240,180,41,.95)'; ctx.strokeRect(x0 + 0.5, 0.5, ww - 1, h - 1);
    }
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const jump = (ev) => {
    const r = ts.getVisibleLogicalRange(), n = src.n(), b = cv.getBoundingClientRect();
    if (!r || n < 2) return;
    setCenter(((ev.clientX - b.left - 2) / (b.width - 4)) * (n - 1), r.to - r.from);
    src.onNav?.();
  };
  cv.addEventListener('pointerdown', (ev) => { dragging = true; cv.setPointerCapture(ev.pointerId); jump(ev); });
  cv.addEventListener('pointermove', (ev) => { if (dragging) jump(ev); });
  cv.addEventListener('pointerup', () => { dragging = false; });
  cv.addEventListener('pointercancel', () => { dragging = false; });
  el.querySelectorAll('button[data-a]').forEach((b) => b.addEventListener('click', () => act(b.dataset.a)));
  ts.subscribeVisibleLogicalRangeChange(schedule);
  new ResizeObserver(schedule).observe(cv);
  const refresh = () => { const n = src.n(); vals = n ? src.values() : []; ticks = n ? src.ticks() : []; schedule(); };
  return { act, refresh, draw: schedule };
}
let tlNav = null, fillNav = null;
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest('input, select, textarea'))) return;
  const a = { ArrowLeft: 'left', ArrowRight: 'right', '+': 'in', '=': 'in', '-': 'out', '0': 'fit' }[e.key];
  const nav = state.view === 'fills' ? fillNav : state.view === 'balance' ? tlNav : null;
  if (!a || !nav) return;
  e.preventDefault(); nav.act(a);
});

function gotoEpisode(epId) {
  const e = E[epId];
  state.month = monthOf(e[1]); state.pendingEp = epId; state.ep = null;
  showView('fills');
  if (cur && cur.month === state.month) selectEpisode(epId, true);
}

/* ---------- 탭 1: 잔고 · 출금 · 월별 손익 ---------- */
let balanceReady = false;
function ensureBalance() {
  if (balanceReady) return;
  balanceReady = true;
  const days = W.days; // [date, bal, pnl, dep, wd, close]
  const sum = (i) => days.reduce((a, d) => a + d[i], 0);
  const totPnl = sum(2), totDep = sum(3), totWd = sum(4);
  const totPnlUsd = W.monthly.reduce((a, m) => a + m[2], 0);
  const last = days[days.length - 1];
  const winMonths = W.monthly.filter((m) => m[1] > 0).length;
  const liqByYear = {};
  IDX.forEach((x) => { if (x.liq) liqByYear[x.month.slice(0, 4)] = (liqByYear[x.month.slice(0, 4)] || 0) + x.liq; });
  const liqTotal = Object.values(liqByYear).reduce((a, b) => a + b, 0);
  const cards = [
    ['첫 입금', btc(days[0][3], 4), days[0][0]],
    ['총 입금', btc(totDep, 2), `${days.filter((d) => d[3] > 0).length}회`],
    ['누적 실현손익', btc(totPnl, 0, true), '달러 환산 ' + usd(totPnlUsd)],
    ['총 출금', btc(totWd, 0), `취소된 출금 ${W.canceledWithdrawals}건 제외`],
    ['최고 잔고', btc(peakDay[1], 0), `${peakDay[0]} · ${usd(peakDay[1] * peakDay[5])}`],
    ['마지막 잔고', btc(last[1], 0), `${last[0]} · ${usd(last[1] * last[5])}`],
    ['수익 난 달', `${winMonths} / ${W.monthly.length}`, '월 실현손익 기준'],
    ['XBTUSD 강제청산', `${liqTotal}건`, Object.entries(liqByYear).map(([y, n]) => `${y}년 ${n}`).join(' · ')],
    ['펀딩 / 수수료 (XBTUSD)', `${btc(E.reduce((a, e) => a + e[18], 0), 0, true)} / ${btc(E.reduce((a, e) => a + e[19], 0), 0, true)}`, '받은 펀딩 순액 / 낸 수수료 순액(메이커 리베이트 포함)'],
  ];
  $('#cards').innerHTML = cards.map(([k, v, s], i) => `<div class="card" style="--i:${i}"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`).join('');

  const tc = buildBalanceTimeline();
  buildYears();
  buildHeat();
  buildLeverage(tc);
  buildWithdrawals(tc);

  // 월별 표
  const endBal = {};
  days.forEach((d) => { endBal[d[0].slice(0, 7)] = d[1]; });
  const meta = Object.fromEntries(IDX.map((x) => [x.month, x]));
  const mrows = W.monthly.map(([m, b, u]) => ({ id: m, m, b, u, bal: endBal[m] || 0, ...(meta[m] || {}) }));
  sortableTable($('#monthTable'), mrows, [
    { key: 'm', label: '월' }, { key: 'b', label: '실현손익' }, { key: 'u', label: '달러 환산' }, { key: 'bal', label: '월말 잔고(BTC)' },
    { key: 'fills', label: 'XBTUSD 체결' }, { key: 'orders', label: '주문' }, { key: 'episodes', label: '라운드트립' }, { key: 'makerPct', label: '메이커' },
    { key: 'maxLong', label: '최대 Long' }, { key: 'maxShort', label: '최대 Short' }, { key: 'liq', label: '강제청산' },
  ], (r) => `<tr data-id="${r.m}"><td>${r.m}</td><td class="${cls(r.b)}">${btc(r.b, 2, true)}</td><td class="${cls(r.u)}">${usd(r.u)}</td>
      <td>${nf(r.bal, 1)}</td><td>${nf(r.fills || 0)}</td><td>${nf(r.orders || 0)}</td><td>${nf(r.episodes || 0)}</td><td>${r.makerPct ?? '-'}%</td>
      <td class="pos">${usd(r.maxLong || 0)}</td><td class="neg">${usd(r.maxShort || 0)}</td><td>${r.liq ? `<span class="tag liq">${r.liq}</span>` : ''}</td></tr>`,
  (id) => gotoMonth(id));

  // 가장 큰 라운드트립 TOP 30
  const top = [...E].filter((e) => e[2] != null).sort((a, b) => b[4] - a[4]).slice(0, 30).map((e) => ({
    id: e[0], start: e[1], dir: e[3], maxpos: e[4], lev: e[15], bal: e[16], entry: e[5], levels: e[6], span: e[7], range: e[8], exit: e[9], pnl: e[10], net: netPnl(e), ret: e[17], liq: e[11], hold: e[2] - e[1],
  }));
  sortableTable($('#topEpTable'), top, [
    { key: 'start', label: '시작(KST)' }, { key: 'dir', label: '방향' }, { key: 'maxpos', label: '최대 포지션' }, { key: 'lev', label: '잔고 대비' }, { key: 'bal', label: '당시 잔고' },
    { key: 'entry', label: '진입 주문' }, { key: 'levels', label: '가격 층' }, { key: 'range', label: '진입 가격 폭' }, { key: 'span', label: '진입 소요' }, { key: 'hold', label: '보유' },
    { key: 'exit', label: '청산 주문' }, { key: 'pnl', label: '가격 손익' }, { key: 'net', label: '순손익' }, { key: 'ret', label: '손익/잔고' }, { key: 'liq', label: '' },
  ], (r) => `<tr data-id="${r.id}"><td>${NOTES[r.id] ? '📝 ' : ''}${kst(r.start, false)}</td><td>${dirTag(r.dir)}</td><td>${usd(r.maxpos)}</td><td>${levTxt(r.lev)}</td><td>${r.bal != null ? nf(r.bal, 1) + ' BTC' : '-'}</td>
      <td>${r.entry}</td><td>${r.levels}</td><td>${nf(r.range, 2)}%</td><td>${dur(r.span)}</td><td>${dur(r.hold)}</td><td>${r.exit}</td>
      <td class="${cls(r.pnl)}">${btc(r.pnl, 2, true)}</td><td class="${cls(r.net)}">${btc(r.net, 2, true)}</td><td class="${cls(r.ret)}">${r.ret != null ? nf(r.ret, 1) + '%' : '-'}</td><td>${r.liq ? '<span class="tag liq">강제청산</span>' : ''}</td></tr>`,
  (id) => gotoEpisode(Number(id)), { key: 'maxpos', dir: -1 });
}
function gotoMonth(m) {
  if (!IDX.some((x) => x.month === m)) return;
  state.month = m; state.ep = null; state.pendingEp = null; showView('fills');
}

/* 타임라인: 잔고 / 월별 손익 / 베팅 배수 / 출금 을 한 차트의 패널 4단으로 (같은 시간축) */
function buildBalanceTimeline() {
  const days = W.days;
  // 끌어도 안 움직임(실수로 밀리는 것 방지). 이동은 아래 이동 막대 · 가로 스와이프 · 키보드, 확대는 핀치 · ⌘/⌥+휠
  const tc = LW.createChart($('#timeline'), { ...baseOpts(),
    handleScroll: { mouseWheel: true, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: false, axisDoubleClickReset: true },
    timeScale: { borderColor: '#1c2128', fixLeftEdge: true, fixRightEdge: true }, // 데이터 밖 빈 곳으로는 안 밀림
    leftPriceScale: { visible: true, borderColor: '#1a1f26' } });
  wheelGuard($('#timeline'));
  if (NARROW.matches) tc.applyOptions({ leftPriceScale: { visible: false } });
  // 1단: 잔고
  const usdS = tc.addSeries(LW.AreaSeries, {
    priceScaleId: 'left', lineColor: 'rgba(88,166,255,.9)', topColor: 'rgba(88,166,255,.22)', bottomColor: 'rgba(88,166,255,0)',
    lineWidth: 1, priceFormat: { type: 'custom', formatter: usd, minMove: 1 }, title: '달러',
  }, 0);
  const btcS = tc.addSeries(LW.LineSeries, { color: '#f0b429', lineWidth: 2, priceFormat: { type: 'custom', formatter: (v) => nf(v, 1) + ' BTC', minMove: 0.01 }, title: '잔고' }, 0);
  const grossS = tc.addSeries(LW.LineSeries, { color: 'rgba(240,180,41,.5)', lineWidth: 1, lineStyle: LW.LineStyle.Dashed, priceLineVisible: false,
    priceFormat: { type: 'custom', formatter: (v) => nf(v, 1) + ' BTC', minMove: 0.01 }, title: '잔고+누적출금' }, 0);
  usdS.setData(days.map((d) => ({ time: d[0], value: d[1] * d[5] })));
  btcS.setData(days.map((d) => ({ time: d[0], value: d[1] })));
  let cumWd = 0;
  grossS.setData(days.map((d) => { cumWd += -d[4]; return { time: d[0], value: d[1] + cumWd }; }));
  const markers = [];
  days.forEach((d) => { if (d[3] > 0) markers.push({ time: d[0], position: 'belowBar', color: '#26a69a', shape: 'arrowUp', text: d[3] >= 1 ? '입금 ' + nf(d[3], 1) : '' }); });
  // 튜터 노트가 있는 라운드트립 = 📝 (같은 날 여러 개면 하나로 묶고 클릭 시 첫 번째로 이동)
  const nearestDay = (iso) => days[Math.min(lowerBound(days, iso), days.length - 1)][0]; // lowerBound는 행[0]을 비교
  const noteDays = new Map();
  Object.keys(NOTES).map(Number).sort((x, y) => E[x][1] - E[y][1]).forEach((id) => {
    const d = nearestDay(new Date(E[id][1] * 1000).toISOString().slice(0, 10));
    if (!noteDays.has(d)) noteDays.set(d, []);
    noteDays.get(d).push(id);
  });
  for (const [d, ids] of noteDays) markers.push({ time: d, position: 'aboveBar', color: '#f0b429', shape: 'circle', size: 1, text: '📝' + (ids.length > 1 ? '×' + ids.length : ''), id: 'note-' + ids.join(',') });
  markers.sort((x, y) => x.time.localeCompare(y.time));
  LW.createSeriesMarkers(btcS, markers);
  // 마커 명중 판정: 라이브러리 hit-test(hoveredObjectId) 우선, 없으면 좌표로 직접(마커 원 + 📝 글자 영역)
  const balByDate = Object.fromEntries(days.map((d) => [d[0], d[1]]));
  const noteHit = (p) => {
    if (p.hoveredObjectId && String(p.hoveredObjectId).startsWith('note-')) return String(p.hoveredObjectId).slice(5).split(',').map(Number);
    if (!p.point || (p.paneIndex != null && p.paneIndex !== 0)) return null;
    for (const [d, ids] of noteDays) {
      const x = tc.timeScale().timeToCoordinate(d); if (x == null || Math.abs(x - p.point.x) > 10) continue;
      const y = btcS.priceToCoordinate(balByDate[d]); if (y == null) continue;
      if (p.point.y >= y - 34 && p.point.y <= y + 6) return ids;
    }
    return null;
  };
  tc.subscribeCrosshairMove((p) => { $('#timeline').style.cursor = noteHit(p) ? 'pointer' : ''; });
  tc.subscribeClick((p) => { const ids = noteHit(p); if (ids) gotoEpisode(ids[0]); });
  window.__tl = { tc, btcS, noteHit };
  // 2단: 월별 실현손익
  const hs = tc.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, title: '월 손익' }, 1);
  const setPnl = (unit) => {
    hs.setData(W.monthly.map(([m, b, u]) => { const v = unit === 'btc' ? b : u; return { time: m + '-01', value: v, color: v >= 0 ? 'rgba(38,166,154,.85)' : 'rgba(239,83,80,.85)' }; }));
    hs.applyOptions({ priceFormat: { type: 'custom', minMove: 0.01, formatter: unit === 'btc' ? (v) => nf(v, 1) + ' BTC' : usd } });
  };
  setPnl('btc');
  segInit($('#pnlUnit'), 'btc', setPnl);
  // 3단: 라운드트립 잔고 대비 배수 (일별 최대, 로그축)
  const eps = E.filter((e) => e[2] != null && e[15] != null);
  const byDay = new Map();
  for (const e of eps) { const d = new Date(e[1] * 1000).toISOString().slice(0, 10); if (!byDay.has(d) || byDay.get(d)[15] < e[15]) byDay.set(d, e); }
  const pts = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const mk = (color) => tc.addSeries(LW.LineSeries, { color, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2.5, priceLineVisible: false, lastValueVisible: false,
    priceFormat: { type: 'custom', formatter: (v) => nf(v, 1) + '배', minMove: 0.01 }, title: '배수' }, 2);
  const lowS = mk('#58a6ff'), highS = mk('#ef5350');
  lowS.setData(pts.filter(([, e]) => e[15] < 5).map(([d, e]) => ({ time: d, value: e[15] })));
  highS.setData(pts.filter(([, e]) => e[15] >= 5).map(([d, e]) => ({ time: d, value: e[15] })));
  lowS.createPriceLine({ price: 1, color: 'rgba(230,235,240,.35)', lineStyle: LW.LineStyle.Dashed, lineWidth: 1, title: '1배' });
  lowS.createPriceLine({ price: 5, color: 'rgba(239,83,80,.5)', lineStyle: LW.LineStyle.Dashed, lineWidth: 1, title: '5배' });
  tc.priceScale('right', 2).applyOptions({ mode: LW.PriceScaleMode.Logarithmic });
  // 4단: 출금 막대 (빈 날은 자리만 두어 시간 간격 유지)
  const wdBars = tc.addSeries(LW.HistogramSeries, { color: 'rgba(239,83,80,.8)', priceLineVisible: false, lastValueVisible: false, title: '출금',
    priceFormat: { type: 'custom', formatter: (v) => nf(v, 0) + ' BTC', minMove: 0.01 } }, 3);
  wdBars.setData(days.map((d) => (d[4] < 0 ? { time: d[0], value: -d[4] } : { time: d[0] })));
  // entireTextOnly: 패널 경계에 걸쳐 잘리는 눈금 글자는 그리지 않음
  tc.priceScale('right', 0).applyOptions({ scaleMargins: { top: 0.08, bottom: 0.04 }, entireTextOnly: true });
  tc.priceScale('left', 0).applyOptions({ scaleMargins: { top: 0.08, bottom: 0.04 }, entireTextOnly: true });
  tc.priceScale('right', 1).applyOptions({ scaleMargins: { top: 0.18, bottom: 0.08 }, entireTextOnly: true });
  tc.priceScale('right', 2).applyOptions({ scaleMargins: { top: 0.2, bottom: 0.1 }, entireTextOnly: true });
  tc.priceScale('right', 3).applyOptions({ scaleMargins: { top: 0.25, bottom: 0.02 }, entireTextOnly: true });
  const panes = tc.panes();
  panes[0].setStretchFactor(4); panes[1].setStretchFactor(1.3); panes[2].setStretchFactor(1.4); panes[3].setStretchFactor(1.1);
  tc.timeScale().fitContent();
  segInit($('#balScale'), 0, (v) => {
    const mode = v === '1' ? LW.PriceScaleMode.Logarithmic : LW.PriceScaleMode.Normal;
    tc.priceScale('right', 0).applyOptions({ mode }); tc.priceScale('left', 0).applyOptions({ mode });
  });
  const markRange = segInit($('#rangeSeg'), 'all', (v) => {
    if (v === 'all') tlNav.act('fit');
    else tc.timeScale().setVisibleRange({ from: `${v}-01-01`, to: `${v}-12-31` });
  });
  // 이동 막대: 시간축 점 = 모든 시리즈 시각의 합집합 (일별 잔고 + 월 1일 + 배수 찍힌 날)
  const allTimes = [...new Set([...days.map((d) => d[0]), ...W.monthly.map((m) => m[0] + '-01'), ...pts.map((p) => p[0])])].sort();
  let lastBal = null;
  const tlVals = allTimes.map((t) => { if (t in balByDate) lastBal = balByDate[t]; return lastBal; });
  tlNav = makeNav($('#tlNav'), tc, {
    n: () => allTimes.length,
    values: () => tlVals,
    ticks: () => allTimes.flatMap((t, i) => {
      const prev = allTimes[i - 1];
      if (i && t.slice(0, 4) !== prev.slice(0, 4)) return [{ i, text: t.slice(0, 4) }];
      if (i && t.slice(5, 7) !== prev.slice(5, 7) && ['04', '07', '10'].includes(t.slice(5, 7))) return [{ i, minor: true }];
      return [];
    }),
    fit: () => { tc.timeScale().setVisibleLogicalRange({ from: 0, to: allTimes.length - 1 }); markRange('all'); },
    onNav: () => markRange('none'),
  });
  tlNav.refresh();
  window.__tl.allTimes = allTimes;
  return tc;
}

/* 연도별 카드 4장 */
function buildYears() {
  const days = W.days;
  const closed = E.filter((e) => e[2] != null);
  const html = [2018, 2019, 2020, 2021].map((y) => {
    const ds = days.filter((d) => d[0].startsWith(String(y)));
    if (!ds.length) return '';
    const prev = days.filter((d) => d[0] < `${y}-01-01`);
    const start = prev.length ? prev[prev.length - 1][1] : 0;
    const end = ds[ds.length - 1][1];
    const pnl = ds.reduce((a, d) => a + d[2], 0), wd = ds.reduce((a, d) => a + d[4], 0), dep = ds.reduce((a, d) => a + d[3], 0);
    const es = closed.filter((e) => new Date(e[1] * 1000).getUTCFullYear() === y);
    const win = es.length ? (100 * es.filter((e) => netPnl(e) > 0).length) / es.length : 0;
    const levs = es.filter((e) => e[15] != null).map((e) => e[15]);
    const over5 = levs.length ? (100 * levs.filter((v) => v >= 5).length) / levs.length : 0;
    const liq = es.filter((e) => e[11]).length;
    // 스파크라인: 그 해 잔고
    const vals = ds.map((d) => d[1]); const mn = Math.min(...vals), mx = Math.max(...vals);
    const pts = vals.map((v, i) => `${(100 * i) / (vals.length - 1)},${28 - (mx > mn ? (26 * (v - mn)) / (mx - mn) : 13) + 1}`).join(' ');
    const row = (k, v) => `<span class="row"><span class="k">${k}</span><span class="v">${v}</span></span>`;
    return `<div class="ycard"><div class="y">${y}</div>
      ${row('잔고', `${start ? btc(start, start < 10 ? 2 : 0) : '0'} → <b>${btc(end, end < 10 ? 2 : 0)}</b>`)}
      ${row('실현손익', `<span class="${cls(pnl)}">${btc(pnl, 0, true)}</span>`)}
      ${row('출금 / 입금', `${btc(-wd, 0)} / ${btc(dep, 1)}`)}
      ${row('잔고 대비 배수 중앙값', `${levs.length ? nf(quantile(levs, 0.5), 1) : '-'}배 · 5배↑ ${nf(over5, 0)}%`)}
      ${row('라운드트립 · 승률', `${nf(es.length)}개 · ${nf(win, 0)}%`)}
      ${row('강제청산', liq ? `<span class="tag liq">${liq}건</span>` : '0')}
      <svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#f0b429" stroke-width="1.3" vector-effect="non-scaling-stroke"/></svg></div>`;
  }).join('');
  $('#years').innerHTML = html;
}

/* 월별 손익 히트맵: 연도 × 12개월 */
const NARROW = matchMedia('(max-width: 700px)');
let heatBasis = 'pct';
function buildHeat(basis = heatBasis) {
  heatBasis = basis;
  const days = W.days;
  const maxAbs = Math.max(...W.monthly.map((m) => Math.abs(m[1])));
  const endBal = {}; days.forEach((d) => { endBal[d[0].slice(0, 7)] = d[1]; });
  const pnl = Object.fromEntries(W.monthly.map((m) => [m[0], m[1]]));
  const months = W.monthly.map((m) => m[0]);
  const cell = (y, mth) => {
    const m = `${y}-${String(mth).padStart(2, '0')}`;
    if (!(m in pnl)) return '<div class="hc empty"></div>';
    const i = months.indexOf(m);
    const startBal = i > 0 ? endBal[months[i - 1]] : days[0][3];
    const pct = startBal ? (100 * pnl[m]) / startBal : 0;
    const a = basis === 'pct' ? Math.min(0.85, 0.12 + Math.abs(pct) / 40) : 0.12 + (0.73 * Math.abs(pnl[m])) / maxAbs;
    const bg = pnl[m] >= 0 ? `rgba(38,166,154,${a})` : `rgba(239,83,80,${a})`;
    return `<div class="hc" data-m="${m}" data-bal="${startBal}" data-pct="${pct}" style="background:${bg}"><b>${pnl[m] >= 0 ? '+' : ''}${nf(pnl[m], pnl[m] < 10 && pnl[m] > -10 ? 1 : 0)}</b><span>${pct >= 0 ? '+' : ''}${nf(pct, 0)}%</span></div>`;
  };
  const YEARS = [2018, 2019, 2020, 2021];
  let html;
  if (NARROW.matches) { // 폰: 행 = 달, 열 = 연도
    html = '<div class="hy"></div>' + YEARS.map((y) => `<div class="hm">${y}</div>`).join('');
    for (let mth = 1; mth <= 12; mth++) html += `<div class="hy">${mth}월</div>` + YEARS.map((y) => cell(y, mth)).join('');
    $('#heat').style.gridTemplateColumns = '38px repeat(4, 1fr)';
  } else {
    html = '<div class="hy"></div>' + Array.from({ length: 12 }, (_, i) => `<div class="hm">${i + 1}월</div>`).join('');
    for (const y of YEARS) html += `<div class="hy">${y}</div>` + Array.from({ length: 12 }, (_, i) => cell(y, i + 1)).join('');
    $('#heat').style.gridTemplateColumns = '';
  }
  $('#heat').innerHTML = html;
  $('#heat').querySelectorAll('.hc[data-m]').forEach((el) => {
    el.addEventListener('click', () => gotoMonth(el.dataset.m));
    el.addEventListener('mouseenter', () => showHeatTip(el));
    el.addEventListener('mousemove', (ev) => moveHeatTip(ev));
    el.addEventListener('mouseleave', () => { $('#htip').style.display = 'none'; });
  });
}
segInit($('#heatBasis'), 'pct', (v) => buildHeat(v));
NARROW.addEventListener('change', () => { if (balanceReady) buildHeat(); });
// 히트맵 툴팁: 그 달의 라운드트립 통계 (episodes.js에서 월별로 집계, 월 구분은 UTC)
const MONTH_STATS = (() => {
  const m = {};
  for (const e of E) {
    if (e[2] == null) continue;
    const k = monthOf(e[1]);
    const s = m[k] || (m[k] = { n: 0, win: 0, maxLev: 0, maxLevId: null, liq: 0, big: null, worst: null, funding: 0, fee: 0, notes: [] });
    s.n++; if (netPnl(e) > 0) s.win++;
    if (e[15] != null && e[15] > s.maxLev) { s.maxLev = e[15]; s.maxLevId = e[0]; }
    if (e[11]) s.liq++;
    if (!s.big || e[4] > s.big[4]) s.big = e;
    if (!s.worst || netPnl(e) < netPnl(s.worst)) s.worst = e;
    s.funding += e[18]; s.fee += e[19];
    if (NOTES[e[0]]) s.notes.push(e[0]);
  }
  return m;
})();
function showHeatTip(el) {
  const m = el.dataset.m, bal = Number(el.dataset.bal), pct = Number(el.dataset.pct);
  const mo = W.monthly.find((x) => x[0] === m), ix = IDX.find((x) => x.month === m), st = MONTH_STATS[m];
  const row = (k, v) => `<div class="tr"><span>${k}</span><b>${v}</b></div>`;
  let h = `<div class="tt">${m}</div>`;
  h += row('실현손익', `<span class="${cls(mo[1])}">${btc(mo[1], 2, true)}</span> · ${usd(mo[2])}`);
  h += row('월초 잔고 → 대비', `${nf(bal, 1)} BTC → <span class="${cls(pct)}">${pct >= 0 ? '+' : ''}${nf(pct, 1)}%</span>`);
  if (ix) h += row('체결 · 주문 · 메이커', `${nf(ix.fills)} · ${nf(ix.orders)} · ${ix.makerPct}%`);
  if (st) {
    h += row('라운드트립 · 승률', `${nf(st.n)}개 · ${nf((100 * st.win) / st.n, 0)}%`);
    h += row('가장 큰 포지션', `${usd(st.big[4])} ${st.big[3] > 0 ? '롱' : '숏'} · ${st.big[15] != null ? nf(st.big[15], 1) + '배' : '-'}`);
    h += row('최대 배수', `<span class="${st.maxLev >= 5 ? 'neg' : ''}">${nf(st.maxLev, 1)}배</span> (#${st.maxLevId})`);
    h += row('최악 한 번', `<span class="neg">${btc(netPnl(st.worst), 2, true)}</span> (#${st.worst[0]})`);
    h += row('펀딩 · 수수료', `<span class="${cls(st.funding)}">${btc(st.funding, 2, true)}</span> · <span class="${cls(st.fee)}">${btc(st.fee, 2, true)}</span>`);
    if (st.notes.length) h += row('튜터 노트', st.notes.map((id) => '#' + id).join(', '));
  }
  h += row('강제청산', ix && ix.liq ? `<span class="tag liq">${ix.liq}건</span>` : '0');
  h += `<div class="tf">누르면 이 달 체결 차트로</div>`;
  const tip = $('#htip'); tip.innerHTML = h; tip.style.display = 'block';
}
function moveHeatTip(ev) {
  const tip = $('#htip'); const w = tip.offsetWidth, hgt = tip.offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
  if (y + hgt > window.innerHeight - 8) y = ev.clientY - hgt - 14;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const levTxt = (v) => (v == null ? '-' : `<span class="${v >= 5 ? 'neg' : ''}">${nf(v, v >= 10 ? 0 : 1)}배</span>`);
const quantile = (arr, q) => { const a = [...arr].sort((x, y) => x - y); if (!a.length) return null; const p = (a.length - 1) * q, lo = Math.floor(p); return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (p - lo); };
// 연도별 잔고 대비 배수 중앙값 (해설에서 비교 기준으로 씀)
const LEV_MED = (() => {
  const by = {};
  for (const e of E) if (e[15] != null) (by[new Date(e[1] * 1000).getUTCFullYear()] ||= []).push(e[15]);
  return Object.fromEntries(Object.entries(by).map(([y, a]) => [y, quantile(a, 0.5)]));
})();
function explainEpisode(e, entry, exit) {
  // 데이터로 만드는 자동 해설. 숫자는 전부 이 라운드트립의 실제 값이다.
  const open = e[2] == null, dir = e[3] > 0 ? '롱' : '숏', year = new Date(e[1] * 1000).getUTCFullYear();
  const yearMed = LEV_MED[year];
  const P = [], lessons = [];
  // 1. 상황
  let s1 = `<b>상황.</b> ${kst(e[1], false)}에 ${dir}으로 시작했다.`;
  if (e[15] != null) {
    s1 += ` 당시 잔고는 ${btc(e[16], e[16] < 10 ? 2 : 0)}, 최대 포지션 ${usd(e[4])}는 잔고의 <b>${nf(e[15], 1)}배</b>`;
    if (yearMed) s1 += ` (${year}년 중앙값 ${nf(yearMed, 1)}배${e[15] > yearMed * 2 ? '보다 훨씬 큼' : e[15] < yearMed / 2 ? '보다 작음' : ' 수준'})`;
    s1 += '.';
  }
  P.push(s1);
  // 2. 진입
  const partial = entry.filter((r) => r.o[5] && r.o[6] < r.o[5]).length;
  let s2 = '<b>진입.</b> ';
  if (e[5] === 1) s2 += `주문 1개로 한 번에 들어갔다. ${e[12] >= 50 ? '시장가처럼 긁은 테이커 체결이다.' : '미리 걸어둔 지정가가 체결됐다.'}`;
  else {
    s2 += `주문 ${e[5]}개를 가격 ${e[6]}층(폭 ${nf(e[8], 2)}%, 층 간격 ${nf(e[8] / Math.max(e[6] - 1, 1), 2)}%)에 나눠 넣었고, 첫 체결부터 마지막 진입 체결까지 <b>${dur(e[7])}</b> 걸렸다. `;
    s2 += e[12] < 30 ? `테이커 비율 ${nf(e[12], 0)}%로 대부분 미리 깔아두고 기다렸다.` : e[12] > 70 ? `테이커 비율 ${nf(e[12], 0)}%로 대부분 시장가로 긁었다.` : `테이커 비율 ${nf(e[12], 0)}%로 깔아두기와 긁기를 섞었다.`;
    if (partial) s2 += ` 진입 주문 ${partial}개는 일부만 체결되고 나머지는 취소·미체결로 남았다.`;
  }
  P.push(s2);
  // 3. 진입 후 가격 흐름 (이 달 분봉 안에서)
  // 포지션을 절반 이상 들고 있던 분(分)만 기준으로 순행·역행을 잰다 (거의 비어 있을 때의 흔들림은 계좌와 무관하므로)
  const C = cur.C, endT = open ? cur.F.fills[cur.F.fills.length - 1][0] : e[2];
  const a = lowerBound(C, e[1]), b = lowerBound(C, endT + 60);
  if (e[13] && b > a && !cur.fallback) {
    const Fl = cur.F.fills;
    let j = lowerBound(Fl, e[1]), pos = 0, hi = -Infinity, lo = Infinity, hiT = 0, loT = 0, hiPos = 0, loPos = 0, heavyMin = 0;
    while (j < Fl.length && Fl[j][0] < e[1]) j++;
    for (let i = a; i < b; i++) {
      const t1 = C[i][0] + 60;
      while (j < Fl.length && Fl[j][0] < t1) { if (Fl[j][8] === e[0]) pos = Fl[j][6]; j++; }
      if (Math.abs(pos) < e[4] * 0.5) continue;
      heavyMin++;
      if (C[i][2] > hi) { hi = C[i][2]; hiT = C[i][0]; hiPos = Math.abs(pos); }
      if (C[i][3] < lo) { lo = C[i][3]; loT = C[i][0]; loPos = Math.abs(pos); }
    }
    if (heavyMin > 0) {
      const mfe = e[3] > 0 ? (hi / e[13] - 1) * 100 : (1 - lo / e[13]) * 100;
      const mae = e[3] > 0 ? (lo / e[13] - 1) * 100 : (1 - hi / e[13]) * 100;
      const mfeT = e[3] > 0 ? hiT : loT, maeT = e[3] > 0 ? loT : hiT, maePos = e[3] > 0 ? loPos : hiPos;
      const levAt = e[15] && e[4] ? (e[15] * maePos) / e[4] : null; // 역행이 찍힌 시각의 실제 포지션 기준 잔고 대비 배수
      P.push(`<b>진입 후 흐름.</b> 포지션을 절반 이상 들고 있던 ${dur(heavyMin * 60)} 동안, 진입 평균가 ${nf(e[13], 1)} 기준 최대 <b class="pos">+${nf(mfe, 2)}%</b> 순행(${md(mfeT)}), 최대 <b class="neg">${nf(mae, 2)}%</b> 역행(${md(maeT)}).` + (mae < -3 && levAt ? ` 그 시각 포지션 ${usd(maePos)}(잔고의 ${nf(levAt, 1)}배)로 계산하면 계좌로는 약 ${nf(mae * levAt, 0)}%가 잠깐 찍혔다는 뜻이다.` : ''));
      if (mae <= -3 && e[10] > 0) lessons.push(`최대 ${nf(mae, 1)}% 역행을 견디고 이익으로 끝났다. 버틴 게 맞았지만, 같은 크기의 역행이 더 갔다면 손실이 컸을 자리다.`);
    }
  }
  // 4. 청산
  const flagsAll = exit.reduce((f, r) => f | r.o[10], 0);
  let s4 = '<b>청산.</b> ';
  if (open) s4 += '연말 기준 아직 열려 있는 포지션이다.';
  else {
    s4 += `보유 ${dur(e[2] - e[1])} 뒤 주문 ${e[9]}개로 ${e[9] >= 4 ? '나눠서' : e[9] === 1 ? '한 번에' : ''} 정리했다.`;
    if (e[14] != null && e[13]) { const mv = (e[3] > 0 ? e[14] / e[13] - 1 : 1 - e[14] / e[13]) * 100; s4 += ` 청산 평균가 ${nf(e[14], 1)}는 진입보다 <b class="${cls(mv)}">${mv > 0 ? '+' : ''}${nf(mv, 2)}%</b> ${mv >= 0 ? '유리한' : '불리한'} 자리다.`; }
    if (flagsAll & 8) s4 += ' <b class="neg">강제청산</b>이 포함돼 있다. 손절 없이 버티다 증거금이 바닥난 것이다.';
    else if (flagsAll & 2) s4 += ' 스탑 주문이 발동해 자동으로 손절됐다.';
    else if (flagsAll & 4) s4 += ' 포지션 청산 버튼(시장가 전량)을 눌렀다.';
  }
  P.push(s4);
  // 5. 결과
  if (!open) {
    const net = netPnl(e);
    let s5 = `<b>결과.</b> 순손익 <b class="${cls(net)}">${btc(net, 2, true)}</b> (가격 ${btc(e[10], 2, true)}, 펀딩 ${btc(e[18], 2, true)}, 수수료 ${btc(e[19], 2, true)})`;
    if (e[17] != null) s5 += `, 당시 잔고의 <b class="${cls(e[17])}">${nf(e[17], 1)}%</b>`;
    P.push(s5 + '.');
    if (Math.abs(e[18]) >= 0.5) lessons.push(e[18] > 0 ? `보유 중 펀딩을 ${btc(e[18], 2)} 받았다. 방향이 맞으면 펀딩까지 수익이 된다.` : `보유 중 펀딩을 ${btc(-e[18], 2)} 냈다. 오래 들고 있으면 펀딩이 비용이 된다.`);
    if (e[19] > 0.3) lessons.push(`수수료를 ${btc(e[19], 2)} 돌려받았다(메이커 리베이트). 깔아두는 매매의 부수입이다.`);
  }
  // 6. 배울 점
  if (e[15] != null) {
    if (e[15] >= 5) lessons.push(`잔고의 ${nf(e[15], 0)}배는 2018년 강제청산 16건이 나온 구간이다. 이 크기는 한 번의 역행으로 계좌가 사라질 수 있다.`);
    else if (e[15] < 1) lessons.push('잔고보다 작게 걸었다. 몇 % 역행해도 계좌가 흔들리지 않는 크기다.');
  }
  if (e[6] >= 5) lessons.push('가격을 여러 층으로 나눠 받아 평균 단가를 분산했다. 대신 일부는 미체결로 남는다.');
  if (e[5] > 1 && e[12] > 70) lessons.push('사다리인데도 테이커가 많다. 급하게 들어간 흔적이고 수수료도 냈다.');
  if (!open && e[9] >= 4) lessons.push('청산도 나눠서 했다. 한 가격에 전부 걸지 않고 구간으로 빠져나오는 방식이다.');
  if (!open && e[11]) lessons.push('강제청산은 최악의 청산이다. 손절 가격을 미리 정해 두었다면 같은 방향 판단으로도 손실이 훨씬 작았다.');
  if (!open && e[17] != null && e[17] <= -20) lessons.push(`잔고의 ${nf(-e[17], 0)}%를 한 번에 잃었다. 이런 손실이 몇 번이면 복구가 어렵다.`);
  return `<div class="expl">${P.map((t) => `<p>${t}</p>`).join('')}${lessons.length ? `<div class="hint">배울 점</div><ul>${lessons.map((l) => `<li>${l}</li>`).join('')}</ul>` : ''}</div>`;
}

function buildLeverage(tc) {
  const eps = E.filter((e) => e[2] != null && e[15] != null);
  const byYear = new Map();
  for (const e of eps) { const y = new Date(e[1] * 1000).getUTCFullYear(); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(e); }
  const years = [...byYear.keys()].sort();
  const stat = (arr) => ({
    n: arr.length, med: quantile(arr.map((e) => e[15]), 0.5), p90: quantile(arr.map((e) => e[15]), 0.9), max: Math.max(...arr.map((e) => e[15])),
    over5: (100 * arr.filter((e) => e[15] >= 5).length) / arr.length, over1: (100 * arr.filter((e) => e[15] >= 1).length) / arr.length,
    liq: arr.filter((e) => e[11]).length, worst: Math.min(...arr.map((e) => e[17])), retMed: quantile(arr.map((e) => e[17]), 0.5),
  });
  const ys = years.map((y) => ({ id: y, year: y, ...stat(byYear.get(y)) }));
  const first = ys[0], last = ys[ys.length - 1];
  const maxEp = eps.reduce((a, e) => (e[15] > a[15] ? e : a));
  const cards = [
    ['잔고 대비 중앙값', `${nf(first.med, 1)}배 → ${nf(last.med, 1)}배`, `${first.year}년 → ${last.year}년`],
    ['5배 이상 걸었던 비율', `${nf(first.over5, 0)}% → ${nf(last.over5, 0)}%`, `${first.year}년 → ${last.year}년`],
    ['가장 크게 걸었던 때', `${nf(maxEp[15], 0)}배`, `${kst(maxEp[1], false).slice(0, 10)} · 잔고 ${btc(maxEp[16], 2)}로 ${usd(maxEp[4])}${maxEp[11] ? ' · 강제청산' : ''}`],
    ['한 번에 가장 크게 잃은 비율', `${nf(Math.min(...ys.map((s) => s.worst)), 0)}%`, '잔고 대비 · 가격 손익 기준'],
  ];
  $('#levCards').innerHTML = cards.map(([k, v, s], i) => `<div class="card" style="--i:${i}"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`).join('');
  sortableTable($('#levTable'), ys, [
    { key: 'year', label: '연도' }, { key: 'n', label: '라운드트립' }, { key: 'med', label: '잔고 대비 중앙값' }, { key: 'p90', label: '상위 10%' }, { key: 'max', label: '최대' },
    { key: 'over1', label: '1배 이상' }, { key: 'over5', label: '5배 이상' }, { key: 'liq', label: '강제청산' }, { key: 'retMed', label: '손익/잔고 중앙값' }, { key: 'worst', label: '최악 한 번' },
  ], (r) => `<tr data-id="${r.year}"><td>${r.year}</td><td>${nf(r.n)}</td><td>${nf(r.med, 2)}배</td><td>${nf(r.p90, 1)}배</td><td>${nf(r.max, 0)}배</td>
      <td>${nf(r.over1, 0)}%</td><td class="${r.over5 >= 10 ? 'neg' : ''}">${nf(r.over5, 0)}%</td><td>${r.liq ? `<span class="tag liq">${r.liq}</span>` : '0'}</td>
      <td class="${cls(r.retMed)}">${nf(r.retMed, 2)}%</td><td class="neg">${nf(r.worst, 0)}%</td></tr>`,
  (id) => tc.timeScale().setVisibleRange({ from: `${id}-01-01`, to: `${id}-12-31` }), { key: 'year', dir: 1 });
}

function buildWithdrawals(tc) {
  const days = W.days;
  const byDate = Object.fromEntries(days.map((d) => [d[0], d]));
  const monthPnl = Object.fromEntries(W.monthly.map((m) => [m[0], m[1]]));
  const totPnl = days.reduce((a, d) => a + d[2], 0);
  const rows = [];
  const wdByDate = new Map();
  for (const [date, amt] of W.withdrawals) {
    const g = wdByDate.get(date) || { date, btc: 0, n: 0 };
    g.btc += -amt; g.n++; wdByDate.set(date, g);
  }
  let cumBtc = 0, cumUsd = 0;
  for (const g of [...wdByDate.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const d = byDate[g.date];
    const after = d[1], before = after + g.btc - d[3];
    cumBtc += g.btc; cumUsd += g.btc * d[5];
    rows.push({ ...g, usd: g.btc * d[5], before, after, pct: (100 * g.btc) / before, cumBtc, cumUsd, mPnl: monthPnl[g.date.slice(0, 7)] });
  }
  const canceled = W.canceled.map(([date, amt]) => ({ date, btc: -amt, canceled: true }));
  const first = rows[0], lastWd = rows[rows.length - 1];
  const maxPct = rows.reduce((a, r) => (r.pct > a.pct ? r : a));
  const avgPct = rows.reduce((a, r) => a + r.pct, 0) / rows.length;
  const cards = [
    ['출금 횟수', `${W.withdrawals.length}회`, `${first.date} ~ ${lastWd.date}`],
    ['첫 출금', btc(first.btc, 2), `${first.date} · 그때 잔고 ${btc(first.before, 1)}`],
    ['누적 출금', btc(cumBtc, 0), `출금 시점 달러 환산 ${usd(cumUsd)}`],
    ['번 돈 대비 출금', `${nf((100 * cumBtc) / totPnl, 0)}%`, `누적 실현손익 ${btc(totPnl, 0)} 중`],
    ['1회 평균 / 최대', `${nf(avgPct, 1)}% / ${nf(maxPct.pct, 1)}%`, `출금 직전 잔고 대비 · 최대 ${maxPct.date}`],
    ['마지막 출금', lastWd.date, `최고 잔고 ${btc(peakDay[1], 0)}(${peakDay[0]}) → 마감 ${btc(days[days.length - 1][1], 0)}`],
  ];
  $('#wdCards').innerHTML = cards.map(([k, v, s], i) => `<div class="card" style="--i:${i}"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`).join('');
  const all = [...rows, ...canceled].sort((a, b) => a.date.localeCompare(b.date) || (a.canceled ? 1 : -1));
  let k = 0;
  const trs = all.map((r) => {
    if (r.canceled) return `<tr class="canceled" data-d="${r.date}"><td>취소</td><td>${r.date}</td><td>${nf(r.btc, 2)}</td><td colspan="7"><span class="tag">취소된 출금 · 합계에서 제외</span></td></tr>`;
    k++;
    return `<tr data-d="${r.date}"><td>${k}</td><td>${r.date}</td><td class="neg">${nf(r.btc, 2)}</td><td>${usd(r.usd)}</td>
      <td>${nf(r.before, 1)}</td><td>${nf(r.pct, 1)}%</td><td>${nf(r.after, 1)}</td><td>${nf(r.cumBtc, 1)}</td><td>${usd(r.cumUsd)}</td>
      <td class="${cls(r.mPnl)}">${btc(r.mPnl, 1, true)}</td></tr>`;
  }).join('');
  $('#wdTable').innerHTML = `<thead><tr><th>#</th><th>날짜</th><th>출금(BTC)</th><th>달러 환산</th><th>출금 직전 잔고</th><th>잔고 대비</th><th>출금 후 잔고</th><th>누적 출금(BTC)</th><th>누적 출금(달러)</th><th>그 달 실현손익</th></tr></thead><tbody>${trs}</tbody>`;
  $('#wdTable').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-d]');
    if (!tr) return;
    const t = Date.parse(tr.dataset.d + 'T00:00:00Z') / 1000;
    const iso = (s) => new Date(s * 1000).toISOString().slice(0, 10);
    tc.timeScale().setVisibleRange({ from: iso(t - 120 * 86400), to: iso(t + 120 * 86400) });
    $('#timeline').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

/* ---------- 탭 3: 가설 검증 (scripts/hypotheses.py → data/hypo.js) ---------- */
let hypoReady = false;
const VERDICT = { '채택': 'ok', '부분 채택': 'part', '기각': 'no' };
function hypoBars(b) {
  // 가로 막대 작은 그림: 줄 = 연도, 막대 = 값. log면 로그 눈금. ref(예: 1.0)에 세로선
  const all = b.rows.flatMap((r) => r.vals.map((v) => v.v)).filter((v) => v > 0);
  const hi = Math.max(...all, b.ref || 0), lo = b.log ? Math.min(...all) * 0.8 : 0;
  const W = (v) => (b.log ? (100 * Math.log(v / lo)) / Math.log((hi * 1.05) / lo) : (100 * v) / (hi * 1.05));
  const fmt = (v) => (b.fmt === '%' ? nf(v, 0) + '%' : nf(v, 2) + '배');
  const refX = b.ref != null ? W(b.ref) : null;
  return `<div class="hb"><div class="hb-t">${b.title}${b.log ? ' · 로그 눈금' : ''}</div>` + b.rows.map((r) => `<div class="hb-r"><span class="hb-l">${r.label}</span><div class="hb-v">`
    + r.vals.map((v, i) => `<div class="hb-i"><span class="hb-n">${v.name}</span><span class="hb-track">${refX != null ? `<i class="hb-ref" style="left:${refX}%"></i>` : ''}<i class="hb-bar c-${v.c}" style="width:${Math.max(1, W(v.v))}%;${v.c === 'q' ? `opacity:${0.35 + 0.16 * i}` : ''}"></i></span><span class="hb-x num">${fmt(v.v)}</span></div>`).join('')
    + `</div></div>`).join('') + (refX != null ? `<div class="hb-foot">세로선 = ${fmt(b.ref)}</div>` : '') + `</div>`;
}
function ensureHypo() {
  if (hypoReady) return;
  hypoReady = true;
  const H = window.__data.hypo;
  const el = $('#hypoList');
  if (!H) { el.innerHTML = '<div class="box"><div class="hint" style="padding:12px">가설 데이터(data/hypo.js)가 없습니다. python3 scripts/hypotheses.py 를 실행하세요.</div></div>'; return; }
  const summary = `<div class="box"><div class="box-h"><h2>한눈에</h2><span class="note">계산일 ${H.built} · 누르면 그 가설로</span></div><div class="hsum">`
    + H.items.map((it) => `<a class="hs" href="#hypo" data-go="${it.id}"><span class="hid">${it.id}</span><span class="ht">${it.title}</span><span class="vp ${VERDICT[it.verdict]}">${it.verdict}</span><span class="hn">${it.verdict_note}</span></a>`).join('')
    + `</div></div>`;
  const queue = `<div class="box"><div class="box-h"><h2>대기 중인 가설</h2><span class="note">study/가설노트.md 의 ‘대기 중’에 한 줄로 적고 Claude에게 “가설 검증해줘”</span></div><div class="hq">`
    + (H.queue.length ? H.queue.map((q) => `<div class="hq-i">🟡 ${q}</div>`).join('') : '<div class="hint">아직 없습니다. 뷰어를 보다가 “워뇨띠는 ~할 때 ~한다”가 떠오르면 노트에 적어 주세요.</div>')
    + `</div></div>`;
  const card = (it) => `<div class="box hcard" id="hypo-${it.id}">
    <div class="box-h"><span class="hid big">${it.id}</span><h2>${it.title}</h2><span class="lbl">${it.area}</span><span class="spacer"></span><span class="vp ${VERDICT[it.verdict]}">${it.verdict}</span></div>
    <div class="hbody">
      <div class="hclaim"><span class="lbl">검증한 문장</span>${it.claim}<div class="hvn">${it.verdict_note}</div></div>
      <div class="cards inner">${it.kpis.map(([k, v, s], i) => `<div class="card" style="--i:${i}"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`).join('')}</div>
      <div class="hgrid">
        <div><div class="sec-h">발견</div><ul class="hf">${it.findings.map((f) => `<li>${f}</li>`).join('')}</ul></div>
        <div>${hypoBars(it.bars)}</div>
      </div>
      <div class="sec-h">연도별</div>
      <div class="tbl-wrap"><table class="htab"><thead><tr>${it.table.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${it.table.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${it.exceptions.map((x) => `<div class="sec-h">예외 · ${x.title}</div><div class="hex">${x.rows.length ? x.rows.map((r) => `<div class="hex-r"><span>${r.text}</span><span class="hex-a">${r.a != null ? `<button class="btn" data-ep="${r.a}">#${r.a}</button><button class="btn" data-ep="${r.b}">#${r.b}</button>` : `<button class="btn" data-month="${r.month}">${r.month} 차트</button>`}</span></div>`).join('') : '<div class="hint">없음</div>'}</div>`).join('')}
      <div class="hrule"><span class="lbl">내 규칙 초안</span>${it.rule}</div>
      <details class="hmore"><summary>방법 · 한계</summary><div class="sec-h">방법</div><ul class="hf">${it.method.map((m) => `<li>${m}</li>`).join('')}</ul><div class="sec-h">한계</div><ul class="hf">${it.limits.map((m) => `<li>${m}</li>`).join('')}</ul></details>
    </div></div>`;
  el.innerHTML = summary + H.items.map(card).join('') + queue;
  el.addEventListener('click', (ev) => {
    const go = ev.target.closest('[data-go]');
    if (go) { ev.preventDefault(); $('#hypo-' + go.dataset.go).scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const b = ev.target.closest('button[data-ep]');
    if (b) { gotoEpisode(Number(b.dataset.ep)); return; }
    const m = ev.target.closest('button[data-month]');
    if (m) gotoMonth(m.dataset.month);
  });
}

/* ---------- 탭 2: 체결 차트 · 라운드트립 ---------- */
let fc, candleS, volumeS, fisherS, triggerS, posS, ov, octx, cur = null, loadToken = 0, dirty = true, lastSig = '', hoverIdx = null, pinned = null, hoverLeg = null;
const wrap = $('#fillChartWrap');
function setMsg(text) { const el = $('#chartMsg'); el.innerHTML = text ? `<div>${text.includes('불러오는') ? '<div class="spin"></div>' : ''}${text}</div>` : ''; el.classList.toggle('on', !!text); }
function ensureFills() {
  if (!fc) initFillChart();
  if (!cur || cur.month !== state.month) loadMonth(state.month);
}

function setPanes() {
  // 같은 시간축에 가격 · 시장 거래량 · Fisher9 · 실제 보유 포지션을 표시한다.
  const panes = fc.panes();
  panes[0].setStretchFactor(4);
  for (const [index, visible, factor, series] of [
    [1, state.showVolume, 1, [volumeS]],
    [2, state.showFisher, 1.8, [fisherS, triggerS]],
    [3, state.showPos, 1, [posS]],
  ]) {
    series.forEach((s) => s.applyOptions({ visible }));
    panes[index].setStretchFactor(visible ? factor : 0.05);
    // v5.2.1의 공통 축 레이아웃은 각 패널의 축 위젯을 요구한다.
    // 숨길 때도 축을 유지하고 시리즈/높이만 줄여 null 축 위젯 오류를 피한다.
    fc.priceScale('right', index).applyOptions({ scaleMargins: { top: 0.12, bottom: 0.08 }, visible: true });
  }
}
function fillCapacity() { return Math.max(50, (wrap.clientWidth - (fc ? fc.priceScale('right').width() : 60)) / 0.5); }
function initFillChart() {
  // v5: 차트 전체 priceFormatter 는 패널 눈금의 시리즈별 포맷을 덮어쓰므로 쓰지 않는다 (lib/V5_MIGRATION.md 참고)
  fc = LW.createChart($('#fillChart'), {
    ...baseOpts(),
    timeScale: { borderColor: '#1c2128', timeVisible: true, secondsVisible: false, rightOffset: 3 },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  });
  candleS = fc.addSeries(LW.CandlestickSeries, {
    upColor: '#1f5b53', downColor: '#6a2f34', borderVisible: false, wickUpColor: '#2f7a6f', wickDownColor: '#8c3f46',
    priceFormat: { type: 'custom', formatter: (p) => nf(p, 1), minMove: 0.5 },
  });
  fc.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.06 } });
  volumeS = fc.addSeries(LW.HistogramSeries, {
    priceFormat: { type: 'volume' }, priceLineVisible: false, title: '시장 거래량(계약)',
  }, 1);
  fisherS = fc.addSeries(LW.LineSeries, {
    color: '#58a6ff', lineWidth: 2, priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    priceLineVisible: false, title: 'Fisher9',
  }, 2);
  triggerS = fc.addSeries(LW.LineSeries, {
    color: '#f0b429', lineWidth: 1, priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    priceLineVisible: false, title: 'Trigger(1봉 전)',
  }, 2);
  for (const price of [-1.5, 0, 1.5]) fisherS.createPriceLine({
    price, color: price === 0 ? '#596574' : '#353d48', lineWidth: 1, lineStyle: LW.LineStyle.Dashed,
    axisLabelVisible: false, title: '',
  });
  // 실제 포지션은 패널 3에 독립된 계약 수량 눈금으로 표시한다.
  posS = fc.addSeries(LW.BaselineSeries, {
    baseValue: { type: 'price', price: 0 }, lineWidth: 1,
    topLineColor: 'rgba(38,166,154,.9)', topFillColor1: 'rgba(38,166,154,.30)', topFillColor2: 'rgba(38,166,154,.04)',
    bottomLineColor: 'rgba(239,83,80,.9)', bottomFillColor1: 'rgba(239,83,80,.04)', bottomFillColor2: 'rgba(239,83,80,.30)',
    priceFormat: { type: 'custom', formatter: (v) => (v > 0 ? 'Long ' : v < 0 ? 'Short ' : '') + usd(Math.abs(v)), minMove: 1 },
    lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false, title: '포지션',
  }, 3);
  setPanes();
  ov = $('#overlay'); octx = ov.getContext('2d');
  wheelGuard(wrap);
  const feed = $('#feedList');
  feed.addEventListener('click', (ev) => {
    const c = ev.target.closest('.fr'); if (!c) return;
    if (c.dataset.sel) selectEpisode(Number(c.dataset.sel), true);
    else if (c.dataset.ep && Number(c.dataset.ep) !== state.ep) { selectEpisode(Number(c.dataset.ep), false); jumpTo(Number(c.dataset.t)); }
    else if (c.dataset.t) jumpTo(Number(c.dataset.t));
  });
  feed.addEventListener('mouseover', (ev) => setHoverLeg(legOf(ev.target.closest('.fr[data-t]')))); // 줄에 올리면 차트의 그 자리에 큰 번호 배지
  feed.addEventListener('mouseleave', () => setHoverLeg(null));
  fc.subscribeCrosshairMove((p) => { // 캔들에 올리면 그 봉의 줄에 불
    if (!p.point || !cur || !cur.bars) { hotFeed([]); return; }
    const i = p.logical != null ? Math.round(p.logical) : null;
    if (i == null || !cur.bars[i]) { hotFeed([]); return; }
    const t0 = cur.bars[i].b, t1 = t0 + cur.tfUsed;
    hotFeed([...feed.querySelectorAll('.fr[data-t]')].filter((c) => +c.dataset.t >= t0 && +c.dataset.t < t1));
  });
  const fold = (v) => { $('#feed').classList.toggle('fold', v); $('#feedFold').textContent = v ? '펴기' : '접기'; store.set('feedFold', v); };
  fold(store.get('feedFold', false));
  $('#feedFold').addEventListener('click', () => fold(!$('#feed').classList.contains('fold')));
  // 해설 속 ①⑯ 같은 번호: 올리면 피드 줄 + 차트 배지에 불, 누르면 그 시각으로
  const epCard = $('#epCard');
  const rowOf = (x) => { const n = x.dataset.n; return state.ep == null ? null : feed.querySelector(`.fr[data-n="${n}"]:not([data-ep])`); };
  epCard.addEventListener('mouseover', (ev) => {
    const x = ev.target.closest('.cref');
    if (!x) return;
    const r = rowOf(x); hotFeed(r ? [r] : []); setHoverLeg(legOf(r));
  });
  epCard.addEventListener('mouseout', (ev) => { if (ev.target.closest('.cref')) { hotFeed([]); setHoverLeg(null); } });
  epCard.addEventListener('click', (ev) => { const x = ev.target.closest('.cref'); const r = x && rowOf(x); if (r) jumpTo(+r.dataset.t); });
  fillNav = makeNav($('#fillNav'), fc, {
    n: () => (cur && cur.bars ? cur.bars.length : 0),
    values: () => cur.bars.map((b) => b.c),
    ticks: () => { // KST 날짜가 바뀌는 봉 = 눈금, 글자 = 일
      const out = []; let prev = null;
      cur.bars.forEach((b, i) => { const d = Math.floor((b.b + KST) / 86400); if (d !== prev) { prev = d; out.push({ i, text: String(new Date(d * 86400000).getUTCDate()) }); } });
      return out;
    },
    marks: () => {
      if (state.ep == null || !cur || !cur.bars) return [];
      const e = E[state.ep], i0 = Math.max(0, barIndex(e[1])), i1 = e[2] == null ? cur.bars.length - 1 : barIndex(e[2]);
      return i1 < 0 ? [] : [{ i0, i1, color: e[3] > 0 ? 'rgba(38,166,154,.5)' : 'rgba(239,83,80,.5)' }];
    },
    // 한 화면에 그릴 수 있는 봉은 (차트 폭 ÷ 최소 봉 간격 0.5px)개. 넘치면 봉을 한 단계 크게 바꿔서 보여 준다
    fit: () => { // 한 달 전체
      if (!cur) return;
      const cap = fillCapacity(), mins = cur.C.length;
      let tf = cur.tfUsed;
      if (!cur.fallback) while (tf < 86400 && (mins * 60) / tf + 6 > cap) tf = TFS[TFS.indexOf(tf) + 1];
      if (tf !== cur.tfUsed) { state.tf = tf; saveHash(); pinned = null; render(true); }
      requestAnimationFrame(() => fc.timeScale().setVisibleLogicalRange({ from: -1, to: cur.bars.length + 2 }));
    },
    zoomOut: (c, w) => { // 더 넓게 볼 수 없으면 봉을 한 단계 크게 (가운데 시각 유지)
      if (!cur || cur.fallback || w + 4 <= fillCapacity() || cur.tfUsed >= 86400) return false;
      const tC = cur.times[clamp(Math.round(c), 0, cur.bars.length - 1)], span = w * cur.tfUsed;
      const tf = TFS[TFS.indexOf(cur.tfUsed) + 1];
      state.tf = tf; saveHash(); pinned = null; render(true);
      requestAnimationFrame(() => {
        const i = barIndex(tC), ww = Math.min(span / tf, fillCapacity() - 4);
        fc.timeScale().setVisibleLogicalRange({ from: i - ww / 2, to: i + ww / 2 });
      });
      return true;
    },
  });

  const idxFromParam = (p) => {
    if (p.logical != null) return Math.round(p.logical);
    if (p.time != null) return barIndex(p.time - KST);
    return null;
  };
  fc.subscribeCrosshairMove((p) => {
    if (pinned != null || !cur || !p.point) return;
    const i = idxFromParam(p);
    if (i == null || i === hoverIdx || !cur.bars[i]) return;
    hoverIdx = i; dirty = true; renderBarCard(i);
  });
  fc.subscribeClick((p) => {
    if (!cur) return;
    const i = idxFromParam(p);
    if (i == null || !cur.bars[i]) return;
    pinned = pinned === i ? null : i;
    hoverIdx = i; dirty = true; renderBarCard(i);
    if (pinned != null) { const ep = episodeAtBar(i); if (ep != null && ep !== state.ep) selectEpisode(ep, false); }
  });

  const monthSel = $('#monthSel');
  const pnlOf = Object.fromEntries(W.monthly.map((m) => [m[0], m[1]]));
  monthSel.innerHTML = IDX.map((x) => `<option value="${x.month}">${x.month}  (${pnlOf[x.month] != null ? btc(pnlOf[x.month], 1, true) : '-'})</option>`).join('');
  monthSel.addEventListener('change', () => { state.month = monthSel.value; state.ep = null; saveHash(); loadMonth(state.month); });
  const stepMonth = (d) => {
    const i = IDX.findIndex((x) => x.month === state.month) + d;
    if (i < 0 || i >= IDX.length) return;
    state.month = IDX[i].month; state.ep = null; saveHash(); loadMonth(state.month);
  };
  $('#prevMonth').addEventListener('click', () => stepMonth(-1));
  $('#nextMonth').addEventListener('click', () => stepMonth(1));
  state.markTf = segInit($('#tfSeg'), state.tf, (v) => { state.tf = Number(v); saveHash(); pinned = null; render(false); });
  segInit($('#liqSeg'), 'all', (v) => { state.filter = v; dirty = true; if (hoverIdx != null) renderBarCard(hoverIdx); });
  $('#showFills').addEventListener('change', (e) => { state.showFills = e.target.checked; dirty = true; });
  $('#showOrders').addEventListener('change', (e) => { state.showOrders = e.target.checked; dirty = true; });
  $('#showLadder').addEventListener('change', (e) => { state.showLadder = e.target.checked; dirty = true; });
  $('#showPos').addEventListener('change', (e) => { state.showPos = e.target.checked; setPanes(); dirty = true; });
  $('#showVolume').addEventListener('change', (e) => { state.showVolume = e.target.checked; setPanes(); dirty = true; });
  $('#showFisher').addEventListener('change', (e) => { state.showFisher = e.target.checked; setPanes(); dirty = true; });
  $('#showEps').addEventListener('change', (e) => { state.showEps = e.target.checked; dirty = true; });
  $('#daySel').addEventListener('change', (e) => {
    const d = Number(e.target.value);
    if (!d) return;
    fc.timeScale().setVisibleRange({ from: d, to: d + 86400 });
    e.target.value = '';
  });
  $('#epSel').addEventListener('change', (e) => { if (e.target.value !== '') selectEpisode(Number(e.target.value), true); else clearEpisode(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.view === 'fills') { pinned = null; clearEpisode(); } });
  const stepEp = (d) => {
    if (!cur) return;
    const ids = cur.eps.map((e) => e[0]);
    const i = state.ep == null ? (d > 0 ? -1 : ids.length) : ids.indexOf(state.ep);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    selectEpisode(ids[j], true);
  };
  $('#prevEp').addEventListener('click', () => stepEp(-1));
  $('#nextEp').addEventListener('click', () => stepEp(1));
  requestAnimationFrame(loop);
}

async function loadMonth(m) {
  const token = ++loadToken;
  $('#monthSel').value = m;
  setMsg(`${m} 불러오는 중…`);
  let F, C, indicators = null, indicatorError = '', fallback = false;
  try { F = await loadData('f_' + m); }
  catch (e) { console.error(e); setMsg(`체결 파일을 못 읽었습니다: ${e.message}`); return; }
  try { C = await loadData('c_' + m); }
  catch (e) {
    console.warn(e); fallback = true;
    C = W.daily.filter((d) => new Date(d[0] * 1000).toISOString().slice(0, 7) === m).map((d) => [...d, 0]);
  }
  if (!fallback) {
    try {
      const response = await fetch(`data/fisher_${m}.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      indicators = await response.json();
      if (indicators.length !== 9 || indicators.source !== 'HL2' || !indicators.series) throw new Error('Fisher9 데이터 형식 오류');
    } catch (e) { indicatorError = `Fisher9 파일을 읽지 못했습니다 (${e.message}). 빌드 후 실행해 주세요.`; }
  }
  if (token !== loadToken) return;
  unloadExcept(['f_' + m, 'c_' + m]);

  const fills = F.fills, orders = F.orders;
  let maxFill = 1, maxOrder = 1, lo = Infinity, hi = -Infinity;
  for (const f of fills) if (f[2] > maxFill) maxFill = f[2];
  for (const o of orders) if (o[5] > maxOrder) maxOrder = o[5];
  for (const c of C) { if (c[3] < lo) lo = c[3]; if (c[2] > hi) hi = c[2]; }
  const dayCount = new Map();
  const epSeen = new Map();
  for (const f of fills) {
    const d = Math.floor((f[0] + KST) / 86400) * 86400;
    dayCount.set(d, (dayCount.get(d) || 0) + 1);
    if (!epSeen.has(f[8])) epSeen.set(f[8], E[f[8]]);
  }
  cur = { month: m, F, C, fallback, indicators, indicatorError, orderRoles: orderRoles(fills), meta: IDX.find((x) => x.month === m), maxFill, maxOrder, refLo: lo, refHi: hi, dayCount,
    eps: [...epSeen.values()] };
  pinned = null; hoverIdx = null; state.ep = null;
  document.querySelectorAll('#tfSeg button').forEach((b) => { b.disabled = fallback && b.dataset.v !== '86400'; });
  setMsg('');
  render(false);
  if (state.pendingEp != null) {
    const id = state.pendingEp; state.pendingEp = null;
    if (cur.eps.some((e) => e[0] === id)) selectEpisode(id, true);
  }
}

function aggregate(c1, tf) {
  return aggregateCandles(c1, tf);
}
function barIndex(t) {
  const a = cur.times;
  if (!a.length || t < a[0]) return -1;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= t) lo = m; else hi = m - 1; }
  return lo;
}
function render(keepRange) {
  if (!cur) return;
  const tf = cur.fallback ? 86400 : state.tf;
  if (state.markTf) state.markTf(tf);
  const bars = aggregate(cur.C, tf);
  cur.bars = bars; cur.tfUsed = tf; cur.times = Float64Array.from(bars, (x) => x.b);
  candleS.setData(bars.map((x) => ({ time: x.b + KST, open: x.o, high: x.h, low: x.l, close: x.c })));
  volumeS.setData(cur.fallback ? [] : bars.filter((x) => x.v !== null).map((x) => ({
    time: x.b + KST, value: x.v, color: x.c >= x.o ? 'rgba(38,166,154,.65)' : 'rgba(239,83,80,.65)',
  })));
  const fisher = cur.indicators?.series[tf] || [];
  cur.fisherByTime = new Map(fisher.map((row) => [row[0], row]));
  fisherS.setData(fisher.map(([t, value]) => ({ time: t + KST, value })));
  triggerS.setData(fisher.map(([t, , value]) => ({ time: t + KST, value })));
  $('#indicatorStatus').textContent = cur.indicatorError || (cur.fallback ? '시장 거래량 · Fisher9: 캔들 원본 없음' : 'Fisher9 · HL2 · Trigger = 1봉 전 · 파랑 Fisher / 노랑 Trigger');
  renderIndicatorValues(state.ep == null ? bars.length - 1 : Math.max(0, barIndex(E[state.ep][2] ?? bars[bars.length - 1].b)));
  const fills = cur.F.fills;
  let j = 0, p = cur.meta.startPos, pmax = 0, pmin = 0;
  cur.posData = bars.map((x) => {
    const end = x.b + tf;
    while (j < fills.length && fills[j][0] < end) { p = fills[j][6]; j++; }
    if (p > pmax) pmax = p; if (p < pmin) pmin = p;
    return { time: x.b + KST, value: p };
  });
  cur.posMax = pmax; cur.posMin = pmin;
  posS.setData(cur.posData);
  if (!keepRange) {
    if (tf <= 1800 && cur.dayCount.size) {
      // 분봉은 체결이 가장 많은 날로 바로 확대 (1·5분: 하루, 30분: 앞뒤 포함 5일)
      const [busiest] = [...cur.dayCount.entries()].sort((a, b) => b[1] - a[1])[0];
      const pad = tf === 1800 ? 2 * 86400 : 0;
      fc.timeScale().setVisibleRange({ from: busiest - pad, to: busiest + 86400 + pad });
    } else fc.timeScale().fitContent();
  }
  renderChips(); renderDaySel(); renderEpSel(); renderRtList(); renderEpTable(); renderCmd(); renderHud(); renderFeed();
  renderEpCard(); renderBarCard(pinned);
  if (fillNav) fillNav.refresh();
  dirty = true;
}

function renderChips() {
  const x = cur.meta;
  const quantities = [0, 0, 0, 0, 0];
  for (const fill of cur.F.fills) quantities[fill[3]] += fill[2];
  const pnl = W.monthly.find((m) => m[0] === cur.month);
  const parts = [
    `체결 <b>${nf(x.fills)}</b>건`, `주문 <b>${nf(x.orders)}</b>개`, `라운드트립 <b>${cur.eps.length}</b>개`,
    `Long 진입/추가 <b class="pos">${usd(quantities[1])}</b> · 축소/종료 <b>${usd(quantities[2])}</b>`,
    `Short 진입/추가 <b class="neg">${usd(quantities[3])}</b> · 축소/종료 <b>${usd(quantities[4])}</b>`, `메이커 <b>${x.makerPct}%</b>`,
    `최대 Long <b class="pos">${usd(Math.abs(x.maxLong))}</b>`, `최대 Short <b class="neg">${usd(Math.abs(x.maxShort))}</b>`,
    `월초 포지션 <b class="${cls(x.startPos)}">${usd(x.startPos)}</b>`,
  ];
  {
    const eps = [...cur.eps].filter((e) => e[2] != null).sort((p, q) => p[1] - q[1]);
    const m0 = Date.parse(cur.month + '-01T00:00:00Z') / 1000, m1 = m0 + 86400 * new Date(Date.UTC(Number(cur.month.slice(0, 4)), Number(cur.month.slice(5)), 0)).getUTCDate();
    let held = 0; // 이 달 안에서 XBTUSD 포지션을 들고 있던 시간 (이전 달에 시작한 라운드트립도 cur.eps 에 포함됨)
    for (const e of eps) held += Math.max(0, Math.min(e[2], m1) - Math.max(e[1], m0));
    const flat = Math.max(0, (m1 - m0) - held);
    parts.push(`무포지션 <b>${nf((100 * flat) / (m1 - m0), 0)}%</b> <span class="note">(XBTUSD 기준)</span>`);
  }
  if (x.liq) parts.push(`<span class="tag liq">강제청산 ${x.liq}건</span>`);
  if (pnl) parts.push(`월 실현손익(전 종목) <b class="${cls(pnl[1])}">${btc(pnl[1], 2, true)}</b>`);
  if (cur.fallback) parts.push('<span class="tag">이 달 분봉 파일이 없어 일봉만 표시</span>');
  $('#chips').innerHTML = parts.map((t, i) => `<span class="${i >= parts.length - 2 ? 'w' : ''}">${t}</span>`).join('');
}
function renderDaySel() {
  const days = [...cur.dayCount.entries()].sort((a, b) => a[0] - b[0]);
  const wd = ['일', '월', '화', '수', '목', '금', '토'];
  $('#daySel').innerHTML = '<option value="">날짜로 이동…</option>' + days.map(([d, n]) => {
    const dt = new Date(d * 1000);
    return `<option value="${d}">${dt.toISOString().slice(5, 10)} (${wd[dt.getUTCDay()]}) · ${nf(n)}건</option>`;
  }).join('');
}
function renderEpSel() {
  const sel = $('#epSel');
  sel.innerHTML = '<option value="">라운드트립 선택…</option>' + cur.eps.map((e) =>
    `<option value="${e[0]}">${NOTES[e[0]] ? '📝 ' : ''}#${e[0]} · ${md(e[1])} · ${e[3] > 0 ? 'Long' : 'Short'} ${usd(e[4])} · ${e[2] == null ? '진행중' : btc(e[10], 2, true)}${e[11] ? ' · 강제청산' : ''}</option>`).join('');
  sel.value = state.ep == null ? '' : String(state.ep);
}
const circ = (n) => (n <= 20 ? String.fromCharCode(0x2460 + n - 1) : n <= 35 ? String.fromCharCode(0x3251 + n - 21) : n <= 50 ? String.fromCharCode(0x32B1 + n - 36) : `(${n})`);
function renderRtList() {
  const el = $('#rtList');
  const closed = cur.eps.filter((e) => e[2] != null);
  const maxAbs = Math.max(1, ...closed.map((e) => Math.abs(netPnl(e))));
  el.innerHTML = cur.eps.map((e) => {
    const net = e[2] == null ? null : netPnl(e);
    const w = net == null ? 0 : Math.max(2, Math.round((60 * Math.abs(net)) / maxAbs));
    return `<div class="rt ${e[0] === state.ep ? 'on' : ''}" data-ep="${e[0]}">
      <span class="a">${NOTES[e[0]] ? '📝 ' : ''}#${e[0]} ${md(e[1])} ${e[3] > 0 ? 'Long' : 'Short'} ${usd(e[4])}</span>
      <span class="b ${net == null ? '' : cls(net)}">${net == null ? '진행중' : (net > 0 ? '+' : '') + nf(net, 2)}</span>
      <span class="c">${e[15] != null ? nf(e[15], 1) + '× · ' : ''}${e[5]}주문 ${e[6]}층${e[2] != null ? ' · ' + dur(e[2] - e[1]) : ''}${e[11] ? ' · <span class="tag liq">청산</span>' : ''}${net == null ? '' : ` <i class="bar ${net < 0 ? 'd' : ''}" style="width:${w}px"></i>`}</span></div>`;
  }).join('');
  el.querySelectorAll('.rt').forEach((x) => x.addEventListener('click', () => selectEpisode(Number(x.dataset.ep), true)));
}
function renderCmd() {
  const el = $('#cmdEp');
  if (!cur) return;
  if (state.ep == null) { el.innerHTML = `<span class="k">${cur.month}</span> <span class="v">라운드트립 ${cur.eps.length}개</span> <span class="k">· 왼쪽 목록이나 캔들을 눌러 고르세요</span>`; return; }
  const e = E[state.ep], open = e[2] == null;
  el.innerHTML = `<span class="v">#${e[0]}</span> <span class="k">${kst(e[1], false)} → ${open ? '진행 중' : kst(e[2], false).slice(5)}</span> <span class="v">${e[3] > 0 ? 'Long' : 'Short'} ${usd(e[4])}</span>`
    + (e[15] != null ? ` <span class="k">잔고의</span> <span class="v">${nf(e[15], 1)}×</span>` : '')
    + (open ? '' : ` <span class="k">순손익</span> <span class="v ${cls(netPnl(e))}">${btc(netPnl(e), 2, true)}</span> <span class="k">(${e[17] != null ? nf(e[17], 1) + '%' : '-'})</span>`);
}
function renderHud() {
  const el = $('#hud');
  if (!cur || state.ep == null) { el.classList.remove('on'); el.innerHTML = ''; return; }
  const e = E[state.ep], open = e[2] == null;
  el.innerHTML = `<span>보유 <b>${open ? '진행 중' : dur(e[2] - e[1])}</b></span><span>진입 <b>${e[5]}주문 ${e[6]}층</b></span><span>테이커 <b>${nf(e[12], 0)}%</b></span>`
    + (open ? '' : `<span>펀딩 <b class="${cls(e[18])}">${btc(e[18], 2, true)}</b></span><span>수수료 <b class="${cls(e[19])}">${btc(e[19], 2, true)}</b></span>`);
  el.classList.add('on');
}
// 행동 이름과 색은 실제 포지션 방향으로 정한다. 원본 주문의 매수/매도는 상세 정보에 보존한다.
function stepLabel(g, e) {
  return groupActionLabel(g, e);
}
// 피드 한 줄 = 매매 한 묶음. 막대 전체 = 이 라운드트립의 최대 포지션, 회색 = 이 줄 뒤 누적, 색 = 이번에 늘리거나 줄인 몫
function feedRow(g, k, e, feed) {
  const color = directionColor(e[3]);
  const price = g.pmin === g.pmax ? nf(g.pmin, 0) : `${nf(g.pmin, 0)}~${nf(g.pmax, 0)}`;
  const after = Math.sign(g.pos) === e[3] ? Math.abs(g.pos) : 0;
  const before = g.inc ? Math.max(0, after - g.qty) : after + g.qty;
  const pct = (v) => Math.min(100, (100 * v) / Math.max(1, e[4]));
  const lo = pct(Math.min(before, after)), hi = pct(Math.max(before, after));
  const mk = g.taker > g.n / 2 ? '테이커' : '메이커';
  const tip = `${stepLabel(g, e)} · ${g.side === 'buy' ? '매수' : '매도'} ${usd(g.qty)} @${price}${g.items.length > 1 ? ` · 주문 ${g.items.length}개` : ''} · ${mk} · 이 줄 뒤 포지션 ${after ? (e[3] > 0 ? 'Long ' : 'Short ') + usd(after) : '0'} (최대의 ${nf(pct(after), 0)}%)`;
  return `<div class="fr" data-t="${g.t0}" data-px="${g.px0}" data-side="${g.side}" data-direction="${e[3]}" data-liq="${g.liq ? 1 : 0}" data-n="${k + 1}"${feed ? ` data-ep="${e[0]}"` : ''} title="${tip}">
    <div class="l1"><span class="n">${circ(k + 1)}</span><span class="tm">${md(g.t0)}${g.t1 - g.t0 >= 60 ? '→' + hm(g.t1) : ''}</span><span class="pill ${g.liq ? 'liq' : color}">${stepLabel(g, e)}</span><span class="q">${usd(g.qty)}</span></div>
    <div class="l2"><span class="px">@${price}${g.items.length > 1 ? ` ×${g.items.length}` : ''} · ${mk}</span><span class="bar"><i class="cum" style="width:${pct(after)}%"></i><i class="${g.liq ? 'liq' : color}" style="left:${lo}%;width:${Math.max(hi - lo, 1.5)}%"></i></span><span class="c">${after ? nf(pct(after), 0) + '%' : '0'}</span></div></div>`;
}
let feedKey = '';
function renderFeed() {
  const el = $('#feedList');
  feedKey = '';
  if (!cur) return;
  if (state.ep == null) { el.innerHTML = '<div class="empty">화면에 보이는 라운드트립의 매매 순서가 여기 나옵니다.</div>'; dirty = true; return; } // 목록은 draw()가 채움
  const e = E[state.ep], groups = cur.tl || (cur.tl = buildTimeline(state.ep));
  el.innerHTML = groups.map((g, k) => feedRow(g, k, e, false)).join('');
  el.scrollTop = 0;
  $('#feedMeta').innerHTML = `#${e[0]} ${e[3] > 0 ? 'Long' : 'Short'} · ${groups.length}줄`;
}
// 라운드트립을 안 골랐을 때: 지금 화면에 걸친 라운드트립들의 순서를 이어서 (화면을 옮기면 따라감)
function syncFeed(tA, tB) {
  const el = $('#feedList');
  if (state.ep == null) {
    const vis = cur.eps.filter((e) => e[1] <= tB && (e[2] ?? Infinity) >= tA);
    const key = vis.length > 25 ? 'many' + vis.length : vis.map((e) => e[0]).join(',');
    if (key !== feedKey) {
      feedKey = key;
      $('#feedMeta').textContent = `화면 속 라운드트립 ${vis.length}개`;
      if (vis.length > 25) el.innerHTML = `<div class="empty">화면에 라운드트립이 ${vis.length}개라 너무 많습니다. 25개 이하로 좁히거나(아래 ＋ 버튼) 하나를 고르면 매매 순서가 나옵니다.</div>`;
      else if (!vis.length) el.innerHTML = '<div class="empty">이 구간에는 라운드트립이 없습니다.</div>';
      else {
        const tl = allTimelines();
        el.innerHTML = vis.map((e) => {
          const net = e[2] == null ? null : netPnl(e);
          return `<div class="fr sep" data-sel="${e[0]}" title="눌러서 이 라운드트립 고르기"><b>#${e[0]} ${e[3] > 0 ? 'Long' : 'Short'} ${usd(e[4])}</b><span class="${net == null ? '' : cls(net)}">${net == null ? '진행 중' : btc(net, 2, true)}</span></div>`
            + (tl.get(e[0]) || []).map((g, k) => feedRow(g, k, e, true)).join('');
        }).join('');
        const first = [...el.querySelectorAll('.fr[data-t]')].find((c) => +c.dataset.t >= tA);
        el.scrollTop = first ? Math.max(0, first.offsetTop - 60) : 0;
      }
    }
  }
  el.querySelectorAll('.fr[data-t]').forEach((c) => c.classList.toggle('out', +c.dataset.t < tA || +c.dataset.t > tB));
}
// 피드의 n번 줄에 불 켜기 (해설의 ⑯ 같은 번호에 마우스를 올렸을 때도 씀)
function hotFeed(rows) {
  const el = $('#feedList');
  el.querySelectorAll('.fr.hot').forEach((c) => c.classList.remove('hot'));
  rows.forEach((c) => c.classList.add('hot'));
  const c = rows[0];
  if (c && (c.offsetTop < el.scrollTop || c.offsetTop + c.offsetHeight > el.scrollTop + el.clientHeight)) el.scrollTo({ top: Math.max(0, c.offsetTop - 50), behavior: 'smooth' });
}
const legOf = (c) => (c ? { t: +c.dataset.t, px: +c.dataset.px, direction: +c.dataset.direction, liq: c.dataset.liq === '1', n: +c.dataset.n } : null);
function setHoverLeg(h) { if ((h && h.t) !== (hoverLeg && hoverLeg.t) || (h && h.n) !== (hoverLeg && hoverLeg.n)) { hoverLeg = h; dirty = true; } }
function epRows() {
  return cur.eps.map((e) => ({
    id: e[0], start: e[1], dir: e[3], maxpos: e[4], lev: e[15], entry: e[5], levels: e[6], span: e[7], range: e[8],
    gap: e[6] > 1 ? e[8] / (e[6] - 1) : 0, exit: e[9], pnl: e[10], net: netPnl(e), ret: e[17], liq: e[11], taker: e[12],
    hold: e[2] == null ? null : e[2] - e[1], open: e[2] == null,
  }));
}
function renderEpTable() {
  sortableTable($('#epTable'), epRows(), [
    { key: 'start', label: '시작(KST)' }, { key: 'dir', label: '방향' }, { key: 'maxpos', label: '최대 포지션' }, { key: 'lev', label: '잔고 대비' }, { key: 'entry', label: '진입 주문' },
    { key: 'levels', label: '가격 층' }, { key: 'gap', label: '층 간격' }, { key: 'range', label: '진입 가격 폭' }, { key: 'span', label: '진입 소요' },
    { key: 'taker', label: '진입 테이커' }, { key: 'hold', label: '보유' }, { key: 'exit', label: '청산 주문' }, { key: 'pnl', label: '가격 손익' }, { key: 'net', label: '순손익(펀딩·수수료 포함)' }, { key: 'ret', label: '손익/잔고' }, { key: 'liq', label: '' },
  ], (r) => `<tr data-id="${r.id}" class="${r.id === state.ep ? 'sel' : ''}"><td>${NOTES[r.id] ? '📝 ' : ''}${kst(r.start, false)}</td><td>${dirTag(r.dir)}</td><td>${usd(r.maxpos)}</td><td>${levTxt(r.lev)}</td>
      <td>${r.entry}</td><td>${r.levels}</td><td>${r.levels > 1 ? nf(r.gap, 2) + '%' : '-'}</td><td>${r.levels > 1 ? nf(r.range, 2) + '%' : '-'}</td><td>${dur(r.span)}</td>
      <td>${nf(r.taker, 0)}%</td><td>${r.open ? '진행중' : dur(r.hold)}</td><td>${r.exit}</td><td class="${cls(r.pnl)}">${r.open ? '-' : btc(r.pnl, 2, true)}</td>
      <td class="${cls(r.net)}">${r.open ? '-' : btc(r.net, 2, true)}</td><td class="${cls(r.ret)}">${r.ret != null ? nf(r.ret, 1) + '%' : '-'}</td><td>${r.liq ? '<span class="tag liq">강제청산</span>' : ''}</td></tr>`,
  (id) => selectEpisode(Number(id), true), { key: 'start', dir: 1 });
}

function episodeAtBar(i) {
  const bar = cur.bars[i], Fl = cur.F.fills;
  const a = lowerBound(Fl, bar.b), b = lowerBound(Fl, bar.b + cur.tfUsed);
  if (b > a) return Fl[a][8];
  const t = bar.b;
  const e = cur.eps.find((e) => e[1] <= t && (e[2] == null || e[2] >= t));
  return e ? e[0] : null;
}
function episodeOrders(epId) {
  // 라운드트립에 속한 주문들: 진입/청산으로 나눠 가격순 정렬
  const Fl = cur.F.fills, O = cur.F.orders, g = new Map();
  for (const f of Fl) {
    if (f[8] !== epId) continue;
    const key = f[5] + (ACT[f[3]].inc ? 'e' : 'x');
    let r = g.get(key);
    if (!r) { r = { oi: f[5], o: O[f[5]], entry: ACT[f[3]].inc, qty: 0, pxq: 0, first: f[0], last: f[0], taker: 0, n: 0 }; g.set(key, r); }
    r.qty += f[2]; r.pxq += f[1] * f[2]; r.last = f[0]; r.taker += f[4]; r.n++;
  }
  const all = [...g.values()];
  return { entry: all.filter((r) => r.entry).sort((a, b) => b.o[2] - a.o[2]), exit: all.filter((r) => !r.entry).sort((a, b) => b.o[2] - a.o[2]) };
}
// 목록 안에서만 스크롤 (scrollIntoView는 페이지까지 움직여서 폰에서 화면이 튐)
function scrollWithin(row) {
  if (!row) return;
  const box = row.closest('.tside'); if (!box) return;
  const r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (r.top < b.top + 40) box.scrollTop -= b.top + 40 - r.top;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
}
function clearEpisode() {
  state.ep = null; saveHash(); cur.tl = null;
  $('#epSel').value = '';
  document.querySelectorAll('#epTable tr.sel').forEach((tr) => tr.classList.remove('sel'));
  document.querySelectorAll('#rtList .rt').forEach((x) => x.classList.toggle('on', Number(x.dataset.ep) === state.ep));
  scrollWithin(document.querySelector('#rtList .rt.on'));
  renderCmd(); renderHud(); renderFeed(); renderEpCard(); dirty = true;
}
function buildTimeline(epId) { return allTimelines().get(epId) || []; }
function allTimelines() {
  // 라운드트립의 주문을 체결 시각 순으로. 같은 방향·같은 역할이 30분 안에 이어지면 한 줄로 묶는다. (달 전체 한 번에, 캐시)
  if (cur.tlAll) return cur.tlAll;
  const Fl = cur.F.fills, O = cur.F.orders, perEp = new Map();
  for (const f of Fl) {
    let per = perEp.get(f[8]);
    if (!per) perEp.set(f[8], (per = new Map()));
    const key = f[5] + (ACT[f[3]].inc ? 'e' : 'x');
    let r = per.get(key);
    if (!r) { r = { t0: f[0], t1: f[0], px0: f[1], inc: ACT[f[3]].inc, side: ACT[f[3]].side, o: O[f[5]], qty: 0, taker: 0, n: 0, pos: f[6], liq: !!(O[f[5]][10] & 8) }; per.set(key, r); }
    r.t1 = f[0]; r.qty += f[2]; r.taker += f[4]; r.n++; r.pos = f[6];
  }
  cur.tlAll = new Map([...perEp].map(([ep, per]) => [ep, groupSteps([...per.values()].sort((a, b) => a.t0 - b.t0))]));
  return cur.tlAll;
}
function groupSteps(rows) {
  const groups = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.inc === r.inc && g.side === r.side && !r.liq && !g.liq && r.t0 - g.t1 <= 1800) {
      g.items.push(r); g.t1 = Math.max(g.t1, r.t1); g.qty += r.qty; g.taker += r.taker; g.n += r.n; g.pos = r.pos;
      g.pmin = Math.min(g.pmin, r.o[2]); g.pmax = Math.max(g.pmax, r.o[2]);
    } else groups.push({ t0: r.t0, t1: r.t1, px0: r.px0, inc: r.inc, side: r.side, items: [r], qty: r.qty, taker: r.taker, n: r.n, pos: r.pos, pmin: r.o[2], pmax: r.o[2], liq: r.liq });
  }
  return groups;
}
function selectEpisode(id, zoom) {
  state.ep = id; saveHash(); cur.tl = buildTimeline(id);
  $('#epSel').value = String(id);
  document.querySelectorAll('#epTable tr[data-id]').forEach((tr) => tr.classList.toggle('sel', Number(tr.dataset.id) === id));
  const e = E[id];
  if (zoom) {
    const lastT = cur.F.fills.length ? cur.F.fills[cur.F.fills.length - 1][0] : e[1];
    const end = e[2] == null ? lastT : e[2];
    const span = Math.max(end - e[1], 60);
    let tf = cur.fallback ? 86400 : state.tf;
    if (!cur.fallback && (span / tf < 10 || span / tf > 600)) {
      tf = TFS.find((x) => span / x <= 400) || 86400;
      state.tf = tf; saveHash(); render(true);
    }
    const pad = Math.max(span * 0.25, 15 * tf);
    const first = cur.times[0], last = cur.times[cur.times.length - 1] + tf;
    fc.timeScale().setVisibleRange({ from: clamp(e[1] - pad, first, last) + KST, to: clamp(end + pad, first, last) + KST });
  } else {
    // 캔들 클릭으로 골랐을 때: 봉 크기는 두고, 라운드트립이 화면 밖에 걸쳐 있으면 구간 전체가 보이게만 옮긴다
    const lr = fc.timeScale().getVisibleLogicalRange();
    const lastT = cur.F.fills.length ? cur.F.fills[cur.F.fills.length - 1][0] : e[1];
    const end = e[2] == null ? lastT : e[2];
    const i0 = barIndex(e[1]), i1 = barIndex(end);
    if (lr && i0 >= 0 && i1 >= 0 && (i0 < lr.from || i1 > lr.to)) {
      const width = Math.max(lr.to - lr.from, 30), need = i1 - i0 + 1;
      const padBars = Math.max(3, Math.round((width - need) / 2));
      fc.timeScale().setVisibleLogicalRange({ from: i0 - padBars, to: i1 + padBars });
    }
  }
  document.querySelectorAll('#rtList .rt').forEach((x) => x.classList.toggle('on', Number(x.dataset.ep) === state.ep));
  scrollWithin(document.querySelector('#rtList .rt.on'));
  renderCmd(); renderHud(); renderFeed(); renderEpCard(); dirty = true;
  renderIndicatorValues(Math.max(0, barIndex(e[2] ?? cur.bars[cur.bars.length - 1].b)));
}
// ①~㊿ → 번호 링크 (태그 안 속성은 건드리지 않게 글자 부분만)
const CIRC_N = (ch) => { const c = ch.charCodeAt(0); return c <= 0x2473 ? c - 0x2460 + 1 : c <= 0x325f ? c - 0x3251 + 21 : c - 0x32b1 + 36; };
const linkCircled = (html) => html.replace(/(<[^>]*>)|([\u2460-\u2473\u3251-\u325f\u32b1-\u32bf])/g, (m, tag, ch) => tag || `<span class="cref" data-n="${CIRC_N(ch)}">${ch}</span>`);
function renderEpCard() {
  const el = $('#epCard');
  if (state.ep == null) {
    const O = cur.F.orders, liq = O.filter((o) => o[10] & 8);
    const big = [...cur.eps].filter((e) => e[2] != null).sort((a, b) => b[4] - a[4]).slice(0, 8);
    el.innerHTML = `<div class="side-h"><div><div class="t">${cur.month} 한눈에 보기</div><div class="m">읽는 법: 1) 라운드트립을 고르면(왼쪽 목록·위 피드의 제목 줄·캔들 클릭) 2) 위 <b>매매 피드</b>에 몇 시에 무엇을 얼마나 했는지 순서대로, 3) 이 자리에 <b>해설 · 사다리 · 수치</b>가 나온다. 해설 속 ①② 번호에 마우스를 올리면 피드 줄과 차트 배지에 불이 들어온다.</div></div></div>
      <div class="side-b">
        ${liq.length ? `<div class="hint" style="color:var(--liq)">강제청산 ${liq.length}건</div>` + liq.map((o) => `<div class="ord link" data-t="${o[8]}"><div class="l1"><span class="act-${cur.orderRoles.get(O.indexOf(o))?.color || 'mixed'}">${cur.orderRoles.get(O.indexOf(o))?.direction > 0 ? 'Long' : 'Short'} 강제청산 ${usd(o[6])}</span><span>${md(o[8])}</span></div><div class="l2">${o[0] > 0 ? '매수' : '매도'} @ ${nf(o[2], 1)}</div></div>`).join('') : ''}
        <div class="hint">이 달 가장 큰 라운드트립 (눌러서 이동)</div>
        ${big.map((e) => `<div class="ord link" data-ep="${e[0]}"><div class="l1"><span>${dirTag(e[3])} ${usd(e[4])}</span><span class="${cls(e[10])}">${btc(e[10], 2, true)}</span></div>
          <div class="l2">${md(e[1])} · 진입 ${e[5]}주문 ${e[6]}층 · ${dur(e[7])} 만에 다 채움 · 보유 ${dur(e[2] - e[1])}</div></div>`).join('')}
      </div>`;
    el.querySelectorAll('.ord[data-ep]').forEach((x) => x.addEventListener('click', () => selectEpisode(Number(x.dataset.ep), true)));
    el.querySelectorAll('.ord[data-t]').forEach((x) => x.addEventListener('click', () => jumpTo(Number(x.dataset.t))));
    return;
  }
  const e = E[state.ep];
  const { entry, exit } = episodeOrders(state.ep);
  const maxQ = Math.max(1, ...entry.map((r) => r.o[5]), ...exit.map((r) => r.o[5]));
  const open = e[2] == null;
  const row = (r, extra) => {
    const o = r.o, side = directionColor(e[3]);
    const w = Math.max(3, (100 * o[5]) / maxQ), fillPct = o[5] ? Math.round((100 * o[6]) / o[5]) : 100;
    const tags = FLAGS.filter(([bit]) => o[10] & bit && bit !== 16).map(([, n, c]) => `<span class="tag ${c || ''}">${n}</span>`).join('');
    return `<div class="p num ${extra}">${nf(o[2], 1)}</div>
      <div class="bar ${side} ${extra}" style="width:${w}%"><i style="width:${fillPct}%"></i></div>
      <div class="lbl num ${extra}"><b class="act-${side}">${e[3] > 0 ? 'Long' : 'Short'} ${r.entry ? '진입/추가' : '축소/종료'} ${usd(r.qty)}</b> · 주문 ${usd(o[5])} · ${fillPct}% · ${md(r.first)}${r.n > 1 && hm(r.last) !== hm(r.first) ? '→' + hm(r.last) : ''} · ${r.taker ? '테이커' : '메이커'}${tags ? ' ' + tags : ''}</div>`;
  };
  const tabs = [['expl', '해설'], ['lad', '사다리'], ['kv', '수치']];
  if (!tabs.some((t) => t[0] === state.ptab)) state.ptab = 'expl';
  const head = `<div class="ep-head"><div class="side-h"><div style="min-width:0">
      <div class="t">라운드트립 #${e[0]} ${dirTag(e[3])} <span class="num">${usd(e[4])}</span> ${e[11] ? '<span class="tag liq">강제청산</span>' : ''}</div>
      <div class="m num">${kst(e[1])} → ${open ? '진행 중(연말)' : kst(e[2]).slice(5)} · 보유 ${open ? '-' : dur(e[2] - e[1])}</div>
      <div class="ep-pnl"><span class="num ${cls(netPnl(e))}" style="font-weight:700;font-size:15px">${open ? '진행 중' : '순손익 ' + btc(netPnl(e), 2, true)}</span>
      <span class="note num">${open ? '' : `가격 ${btc(e[10], 2, true)} · 펀딩 ${btc(e[18], 2, true)} · 수수료 ${btc(e[19], 2, true)}`}</span></div></div></div>
    <div class="ptabs">${tabs.map(([k, n]) => `<button class="ptab ${state.ptab === k ? 'on' : ''}" data-k="${k}">${n}</button>`).join('')}</div></div>`;
  const bodies = {
    expl: `${NOTES[e[0]] ? `<div class="sec-h">튜터 노트</div><div class="expl note">${NOTES[e[0]]}</div>` : ''}
      <div class="sec-h">해설 · 데이터로 자동 생성</div>${EXPL[e[0]] ? `<div class="expl">${EXPL[e[0]]}</div>` : explainEpisode(e, entry, exit)}`,
    lad: `<div class="sec-h">진입 주문 사다리 · 가격 높은 순 · 막대 = 주문 크기 · 진한 부분 = 체결</div>
      <div class="lad">${entry.map((r) => row(r, '')).join('')}</div>
      ${exit.length ? `<div class="sec-h">청산 주문</div><div class="lad">${exit.map((r) => row(r, 'exit')).join('')}</div>` : ''}`,
    kv: `<div class="kv num">
        <div><div class="k">잔고 대비 베팅</div><div class="v">${e[15] != null ? `${levTxt(e[15])} <span class="note">· 당시 잔고 ${btc(e[16], e[16] < 10 ? 2 : 0)}</span>` : '-'}</div></div>
        <div><div class="k">손익 / 당시 잔고</div><div class="v ${cls(e[17])}">${e[17] != null ? nf(e[17], 1) + '%' : '-'}</div></div>
        <div><div class="k">진입 방식</div><div class="v">${e[5] === 1 ? '주문 1개 · 한 번에' : `주문 ${e[5]}개 · 가격 ${e[6]}층`}</div></div>
        <div><div class="k">진입 가격 폭 / 층 간격</div><div class="v">${e[6] > 1 ? `${nf(e[8], 2)}% / ${nf(e[8] / (e[6] - 1), 2)}%` : '-'}</div></div>
        <div><div class="k">첫 체결 → 마지막 진입 체결</div><div class="v">${dur(e[7])}</div></div>
        <div><div class="k">진입 테이커 비율</div><div class="v">${nf(e[12], 0)}% <span class="note">(나머진 미리 걸어둔 주문)</span></div></div>
        <div><div class="k">진입 평균가 → 청산 평균가</div><div class="v">${e[13] != null ? nf(e[13], 1) : '-'} → ${e[14] != null ? nf(e[14], 1) : '-'}</div></div>
        <div><div class="k">청산 주문 수</div><div class="v">${e[9]}</div></div>
      </div>`,
  };
  el.innerHTML = head + `<div class="side-b">${state.ptab === 'expl' ? linkCircled(bodies.expl) : bodies[state.ptab]}</div>`;
  el.querySelectorAll('.ptab').forEach((b) => b.addEventListener('click', () => { state.ptab = b.dataset.k; store.set('ptab', state.ptab); renderEpCard(); }));
}
function renderIndicatorValues(idx) {
  const bar = cur?.bars?.[idx];
  const row = bar && cur.fisherByTime.get(bar.b);
  $('#indicatorValues').textContent = bar ? `${kst(bar.b, false)} · 시장 거래량 ${cur.fallback || bar.v === null ? '없음' : nf(bar.v) + ' 계약'} · Fisher ${row ? nf(row[1], 3) : '없음'} · Trigger ${row ? nf(row[2], 3) : '없음'}` : '';
}
function renderBarCard(idx) {
  const el = $('#barCard');
  if (idx == null || !cur || !cur.bars || !cur.bars[idx]) {
    el.innerHTML = `<div class="side-h"><div class="m">캔들에 마우스를 올리면 그 봉의 주문·체결이 여기 나옵니다. 클릭하면 고정되고 그 라운드트립이 선택됩니다. Esc = 선택 해제.</div></div>`;
    return;
  }
  const bar = cur.bars[idx], tf = cur.tfUsed, Fl = cur.F.fills, O = cur.F.orders;
  renderIndicatorValues(idx);
  const fisher = cur.fisherByTime.get(bar.b);
  const a = lowerBound(Fl, bar.b), b = lowerBound(Fl, bar.b + tf);
  const groups = new Map();
  for (let k = a; k < b; k++) {
    const f = Fl[k];
    if (!passFilter(f)) continue;
    let g = groups.get(f[5]);
    if (!g) { g = { oi: f[5], qty: 0, pxq: 0, n: 0, taker: 0, acts: {}, ep: f[8] }; groups.set(f[5], g); }
    g.qty += f[2]; g.pxq += f[1] * f[2]; g.n++; g.taker += f[4]; g.acts[f[3]] = (g.acts[f[3]] || 0) + f[2];
  }
  const list = [...groups.values()].sort((x, y) => y.qty - x.qty);
  const pos = cur.posData[idx].value;
  const head = `<div class="side-h"><div><div class="t num">${kst(bar.b, false)} · ${TF_NAME[tf]}봉 ${pinned === idx ? '📌' : ''}</div>
    <div class="m num">시 ${nf(bar.o, 1)} · 고 ${nf(bar.h, 1)} · 저 ${nf(bar.l, 1)} · 종 ${nf(bar.c, 1)} · 봉 끝 포지션 <span class="${cls(pos)}">${pos > 0 ? 'Long ' : pos < 0 ? 'Short ' : ''}${usd(Math.abs(pos))}</span></div>
    <div class="m num">시장 거래량 ${cur.fallback || bar.v === null ? '없음' : nf(bar.v) + ' 계약'} · Fisher9 ${fisher ? nf(fisher[1], 3) : '없음'} · Trigger ${fisher ? nf(fisher[2], 3) : '없음'}</div></div></div>`;
  if (!list.length) { el.innerHTML = head + '<div class="side-b"><div class="hint">이 봉에는 체결이 없습니다.</div></div>'; return; }
  const body = list.slice(0, 30).map((g) => {
    const o = O[g.oi];
    const acts = Object.entries(g.acts).map(([k, q]) => `<span class="act-${ACT[k].color}">${ACT[k].name} ${usd(q)}</span>`).join(' · ');
    const fillPct = o[5] ? Math.round((o[6] / o[5]) * 100) : 100;
    const tags = FLAGS.filter(([bit]) => o[10] & bit).map(([, name, c]) => `<span class="tag ${c || ''}">${name}</span>`).join('');
    return `<div class="ord"><div class="l1"><span>${acts}</span><span class="num">@ ${nf(g.pxq / g.qty, 1)}</span></div>
      <div class="l2 num">${o[0] > 0 ? '매수' : '매도'} ${ORDTYPE[o[1]] || o[1]} ${usd(o[5])} @ ${nf(o[2], 1)}${o[3] !== o[4] ? ` (${nf(o[3], 1)}~${nf(o[4], 1)})` : ''}${o[11] ? ` · 스탑 ${nf(o[11], 1)}` : ''} · 체결률 ${fillPct}%${o[7] > 0 ? ` · 미체결 ${usd(o[7])}` : ''}</div>
      <div class="l2 num">이 봉 ${g.n}건(테이커 ${g.taker}) · 첫 체결 ${kst(o[8]).slice(5)} → 마지막 ${kst(o[9]).slice(5)} · 라운드트립 #${g.ep}</div>
      ${tags ? `<div class="l2">${tags}</div>` : ''}</div>`;
  }).join('');
  el.innerHTML = head + `<div class="side-b">${body}${list.length > 30 ? `<div class="hint">외 ${list.length - 30}개 주문</div>` : ''}</div>`;
}
const passFilter = (f) => state.filter === 'all' || (state.filter === 'taker' ? f[4] === 1 : f[4] === 0);
function jumpTo(t) {
  const i = barIndex(t);
  if (i < 0) return;
  const span = cur.tfUsed <= 1800 ? 90 : 40;
  fc.timeScale().setVisibleLogicalRange({ from: i - span, to: i + span });
  pinned = i; hoverIdx = i; dirty = true; renderBarCard(i);
}

/* ---------- 오버레이: 체결점 · 주문선 · 사다리 · 포지션 눈금 ---------- */
function loop() {
  if (state.view === 'fills' && cur && cur.bars) {
    const lr = fc.timeScale().getVisibleLogicalRange();
    const sig = lr ? [lr.from.toFixed(3), lr.to.toFixed(3), candleS.priceToCoordinate(cur.refLo), candleS.priceToCoordinate(cur.refHi), wrap.clientWidth, wrap.clientHeight].join('|') : '';
    if (dirty || sig !== lastSig) { lastSig = sig; dirty = false; draw(); }
  }
  requestAnimationFrame(loop);
}
function tri(x, y, r, up, rgb, filled, alpha) {
  octx.globalAlpha = alpha;
  octx.beginPath();
  if (up) { octx.moveTo(x, y - r); octx.lineTo(x + r * 0.9, y + r * 0.75); octx.lineTo(x - r * 0.9, y + r * 0.75); }
  else { octx.moveTo(x, y + r); octx.lineTo(x + r * 0.9, y - r * 0.75); octx.lineTo(x - r * 0.9, y - r * 0.75); }
  octx.closePath();
  if (filled) { octx.fillStyle = `rgb(${rgb})`; octx.fill(); octx.lineWidth = 0.6; octx.strokeStyle = 'rgba(0,0,0,.6)'; octx.stroke(); }
  else { octx.lineWidth = 1.5; octx.strokeStyle = `rgb(${rgb})`; octx.stroke(); }
  octx.globalAlpha = 1;
}
function draw() {
  if (fillNav) fillNav.draw(); // 선택한 라운드트립 표시가 미니맵에도 반영되게
  const w = wrap.clientWidth, h = wrap.clientHeight, dpr = window.devicePixelRatio || 1;
  if (ov.width !== Math.round(w * dpr) || ov.height !== Math.round(h * dpr)) {
    ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr); ov.style.width = w + 'px'; ov.style.height = h + 'px';
  }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.clearRect(0, 0, w, h);
  const ts = fc.timeScale(), lr = ts.getVisibleLogicalRange();
  if (!lr || !cur.bars.length) return;
  const n = cur.bars.length, i0 = clamp(Math.floor(lr.from), 0, n - 1), i1 = clamp(Math.ceil(lr.to), 0, n - 1);
  const tA = cur.times[i0], tB = cur.times[i1] + cur.tfUsed;
  syncFeed(tA, tB);
  const c0 = ts.logicalToCoordinate(0), c1 = ts.logicalToCoordinate(1);
  if (c0 == null || c1 == null) return;
  const spacing = c1 - c0;
  const X = (t) => { const i = barIndex(t); return i < 0 ? null : c0 + i * spacing + ((t - cur.times[i]) / cur.tfUsed - 0.5) * spacing; };
  const plotW = w - fc.priceScale('right').width(), plotH = fc.panes()[0].getHeight(); // 패널 0(캔들)만 그림
  const font = getComputedStyle(document.documentElement).getPropertyValue('--mono');
  const O = cur.F.orders, Fl = cur.F.fills, sel = state.ep;

  // 라운드트립 경계: 시작 시각마다 세로 점선 + 라벨, 이웃끼리 번갈아 옅은 띠 (두 패널에 걸쳐)
  if (state.showEps) {
    const hAll = h - ts.height();
    const eps = cur.eps.filter((e) => (e[2] ?? tB) >= tA && e[1] <= tB);
    const dense = eps.length > 80;
    octx.save(); octx.beginPath(); octx.rect(0, 0, plotW, hAll); octx.clip();
    octx.font = `10.5px ${font}`;
    let lastLabelX = -Infinity;
    for (const e of eps) {
      const x0 = X(Math.max(e[1], tA)), x1 = X(Math.min(e[2] ?? tB, tB));
      if (x0 == null || x1 == null) continue;
      const wpx = x1 - x0;
      if (wpx >= 1) { octx.fillStyle = `rgba(${e[3] > 0 ? RGB.buy : RGB.sell},${e[0] === sel ? 0.11 : 0.045})`; octx.fillRect(x0, 0, wpx, hAll); }
      if (e[1] >= tA && (!dense || wpx >= 6)) {
        octx.strokeStyle = e[0] === sel ? 'rgba(88,166,255,.95)' : 'rgba(139,149,163,.5)'; octx.lineWidth = 1; octx.setLineDash([3, 3]);
        octx.beginPath(); octx.moveTo(Math.round(x0) + 0.5, 0); octx.lineTo(Math.round(x0) + 0.5, hAll); octx.stroke();
      }
      if (wpx >= 56 && x0 - lastLabelX >= 54) {
        lastLabelX = x0;
        const txt = `#${e[0]} ${e[3] > 0 ? 'Long' : 'Short'} ${usd(e[4])}${e[2] == null ? '' : ' ' + (e[10] >= 0 ? '+' : '') + nf(e[10], 0)}`;
        const tw = octx.measureText(txt).width;
        octx.fillStyle = e[0] === sel ? 'rgba(88,166,255,.18)' : 'rgba(14,17,22,.85)'; octx.fillRect(x0 + 3, 4, tw + 8, 15);
        octx.fillStyle = e[0] === sel ? '#d5dbe3' : e[3] > 0 ? `rgba(${RGB.buy},.9)` : `rgba(${RGB.sell},.9)`; octx.fillText(txt, x0 + 7, 15);
      }
    }
    // 무포지션 구간: 이웃 라운드트립 사이의 빈 시간 (XBTUSD 기준)
    octx.fillStyle = 'rgba(139,149,163,.75)'; octx.textAlign = 'center';
    for (let i = 0; i + 1 < eps.length; i++) {
      const endT = eps[i][2], nextT = eps[i + 1][1];
      if (endT == null || nextT <= endT) continue;
      const x0 = X(Math.max(endT, tA)), x1 = X(Math.min(nextT, tB));
      if (x0 == null || x1 == null || x1 - x0 < 46) continue;
      octx.fillText(`무포 ${dur(nextT - endT)}`, (x0 + x1) / 2, 15);
    }
    octx.textAlign = 'left';
    octx.setLineDash([]); octx.restore();
  }

  octx.save(); octx.beginPath(); octx.rect(0, 0, plotW, plotH); octx.clip();
  const inEp = (epId) => sel == null || epId === sel;

  // 선택한 라운드트립 구간 음영 + 호버/고정 봉 강조
  const hi = pinned ?? hoverIdx;
  if (hi != null && cur.bars[hi]) {
    octx.fillStyle = pinned != null ? 'rgba(88,166,255,.12)' : 'rgba(255,255,255,.04)';
    octx.fillRect(c0 + hi * spacing - spacing / 2, 0, Math.max(spacing, 1), plotH);
  }

  // 주문 가격선
  const visOrders = [];
  for (let k = 0; k < O.length; k++) if (O[k][9] >= tA && O[k][8] <= tB) visOrders.push(k);
  const epOrderSet = sel == null ? null : new Set(episodeOrders(sel).entry.concat(episodeOrders(sel).exit).map((r) => r.oi));
  if (state.showOrders) {
    octx.font = `10.5px ${font}`;
    const usedY = [];
    const label = visOrders.length <= 40;
    for (const k of visOrders.sort((a, b) => O[b][5] - O[a][5])) {
      const o = O[k], y = candleS.priceToCoordinate(o[2]);
      let xa = X(o[8]), xb = X(o[9]);
      if (y == null || xa == null || xb == null) continue;
      if (xb - xa < 8) { xa -= 4; xb += 4; }
      const role = cur.orderRoles.get(k) || { color: 'mixed', label: '방향 미확인' };
      const rgb = RGB[role.color], dim = epOrderSet && !epOrderSet.has(k);
      if (dim) continue; // 라운드트립을 골랐으면 그 주문선만
      if (sel != null) { octx.fillStyle = `rgba(${rgb},.20)`; octx.fillRect(xa, y - 4, Math.max(xb - xa, 2), 8); } // 체결이 이어진 구간
      octx.strokeStyle = `rgba(${rgb},0.75)`;
      octx.lineWidth = 1 + 3.5 * Math.sqrt(o[5] / cur.maxOrder);
      octx.setLineDash(o[7] > 0 ? [5, 3] : []);
      octx.beginPath(); octx.moveTo(xa, y); octx.lineTo(xb, y); octx.stroke();
      if (label && !dim && xb + 4 >= 0 && !usedY.some((u) => Math.abs(u - y) < 11)) { // 선 끝이 화면 왼쪽 밖이면 글자 생략
        usedY.push(y);
        const pct = o[5] ? Math.round((o[6] / o[5]) * 100) : 100;
        octx.fillStyle = `rgba(${rgb},.95)`;
        octx.fillText(`${role.label} ${usd(o[5])}${pct < 100 ? ` (${pct}%)` : ''}`, xb + 4, y - 3);
      }
    }
    octx.setLineDash([]);
  }

  // 체결점
  if (state.showFills) {
    const a = lowerBound(Fl, tA), b = lowerBound(Fl, tB);
    const liqs = [], later = [];
    const drawFill = (f, alpha, glow) => {
      const y = candleS.priceToCoordinate(f[1]), x = X(f[0]);
      if (y == null || x == null) return;
      const m = ACT[f[3]];
      if (glow) { octx.shadowColor = `rgba(${RGB[m.color]},.85)`; octx.shadowBlur = 7; }
      tri(x, y, 2 + 9 * Math.sqrt(f[2] / cur.maxFill), m.direction > 0, RGB[m.color], m.inc, alpha);
      octx.shadowBlur = 0;
    };
    for (let k = a; k < b; k++) {
      const f = Fl[k];
      if (!passFilter(f)) continue;
      if (O[f[5]][10] & 8) { liqs.push(f); continue; }
      if (inEp(f[8])) later.push(f); else drawFill(f, 0.14);
    }
    for (const f of later) drawFill(f, 0.92, sel != null && later.length <= 400);
    octx.strokeStyle = '#b388ff'; octx.lineWidth = 2.6; octx.fillStyle = '#b388ff'; octx.font = `bold 11px ${font}`; octx.shadowColor = 'rgba(179,136,255,.9)'; octx.shadowBlur = 9;
    for (const f of liqs) {
      const y = candleS.priceToCoordinate(f[1]), x = X(f[0]);
      if (y == null || x == null) continue;
      octx.beginPath(); octx.moveTo(x - 7, y - 7); octx.lineTo(x + 7, y + 7); octx.moveTo(x + 7, y - 7); octx.lineTo(x - 7, y + 7); octx.stroke();
      octx.fillText(`강제청산 ${usd(f[2])}`, x + 10, y + 4);
    }
    octx.shadowBlur = 0;
  }

  // 번호 배지: 선택한 라운드트립의 매매 일지 순서를 차트에 표시 (일지의 번호와 같음)
  if (sel != null && cur.tl && cur.tl.length <= 80) {
    octx.font = `bold 10px ${font}`; octx.textAlign = 'center';
    cur.tl.forEach((g, i) => {
      if (g.t0 < tA || g.t0 > tB) return;
      const x = X(g.t0), y = candleS.priceToCoordinate(g.px0);
      if (x == null || y == null) return;
      const direction = E[sel][3];
      const by = direction > 0 ? y + 18 : y - 18, col = g.liq ? '#b388ff' : `rgb(${RGB[directionColor(direction)]})`;
      octx.strokeStyle = col; octx.lineWidth = 1; octx.beginPath(); octx.moveTo(x, y); octx.lineTo(x, by); octx.stroke();
      octx.fillStyle = col; octx.beginPath(); octx.arc(x, by, 8, 0, Math.PI * 2); octx.fill();
      octx.fillStyle = '#0b0d10'; octx.fillText(String(i + 1), x, by + 3.5);
    });
    octx.textAlign = 'left';
  }
  // 아래 목록 카드에 마우스를 올린 줄: 세로 안내선 + 큰 배지
  if (hoverLeg && hoverLeg.t >= tA && hoverLeg.t <= tB) {
    const x = X(hoverLeg.t), y = candleS.priceToCoordinate(hoverLeg.px);
    if (x != null && y != null) {
      const by = hoverLeg.direction > 0 ? y + 20 : y - 20, col = hoverLeg.liq ? '#b388ff' : `rgb(${RGB[directionColor(hoverLeg.direction)]})`;
      octx.strokeStyle = 'rgba(240,180,41,.55)'; octx.lineWidth = 1; octx.setLineDash([2, 3]);
      octx.beginPath(); octx.moveTo(Math.round(x) + 0.5, 0); octx.lineTo(Math.round(x) + 0.5, plotH); octx.stroke(); octx.setLineDash([]);
      octx.save(); octx.shadowColor = col; octx.shadowBlur = 14;
      octx.fillStyle = col; octx.beginPath(); octx.arc(x, by, 11, 0, Math.PI * 2); octx.fill(); octx.restore();
      octx.strokeStyle = '#f0b429'; octx.lineWidth = 2; octx.beginPath(); octx.arc(x, by, 13, 0, Math.PI * 2); octx.stroke();
      octx.fillStyle = '#0b0d10'; octx.font = `bold 11px ${font}`; octx.textAlign = 'center'; octx.fillText(String(hoverLeg.n), x, by + 4); octx.textAlign = 'left';
    }
  }

  // 사다리: 보이는 구간 주문을 오른쪽 가장자리에 가격별 막대로
  if (state.showLadder && visOrders.length) {
    const maxQ = Math.max(...visOrders.map((k) => O[k][5]));
    const anchor = plotW - 6, maxLen = Math.min(150, plotW * 0.22);
    octx.font = `10.5px ${font}`;
    const cands = visOrders.map((k) => ({ k, y: candleS.priceToCoordinate(O[k][2]) }))
      .filter((c) => c.y != null && c.y >= -20 && c.y <= plotH + 20).sort((p, q) => p.y - q.y);
    // 막대 두께는 이웃 주문과의 간격에 맞춰 줄인다 (촘촘한 사다리가 한 덩어리로 보이지 않게)
    for (let i = 0; i < cands.length; i++) {
      const gap = Math.min(i > 0 ? cands[i].y - cands[i - 1].y : 99, i < cands.length - 1 ? cands[i + 1].y - cands[i].y : 99);
      cands[i].h = clamp(gap - 1.5, 1.5, 6);
    }
    for (const c of [...cands].sort((p, q) => O[q.k][5] - O[p.k][5])) {
      const o = O[c.k], side = cur.orderRoles.get(c.k)?.color || 'mixed', dim = epOrderSet && !epOrderSet.has(c.k);
      const len = 14 + (maxLen - 14) * Math.sqrt(o[5] / maxQ), fillFrac = o[5] ? Math.min(1, o[6] / o[5]) : 1;
      c.len = len; c.dim = dim;
      octx.globalAlpha = dim ? 0.4 : 0.85;
      octx.fillStyle = `rgba(${RGB[side]},.25)`; octx.fillRect(anchor - len, c.y - c.h / 2, len, c.h);
      octx.fillStyle = `rgb(${RGB[side]})`; octx.fillRect(anchor - len * fillFrac, c.y - c.h / 2, len * fillFrac, c.h);
      if (c.h >= 4) { octx.strokeStyle = `rgba(${RGB[side]},.7)`; octx.lineWidth = 1; octx.strokeRect(anchor - len + 0.5, c.y - c.h / 2 + 0.5, len - 1, c.h - 1); }
      octx.globalAlpha = 1;
    }
    // 라벨: 붙어 있는 같은 방향 주문은 묶어서 한 줄로 (개수 · 합계 · 체결률 · 가격대)
    const clusters = [];
    for (const c of cands) {
      const role = cur.orderRoles.get(c.k) || { color: 'mixed', label: '방향 미확인' };
      const side = role.color;
      const last = clusters[clusters.length - 1];
      if (last && last.side === side && last.role === role.label && last.dim === c.dim && c.y - last.y1 <= 9) { last.items.push(c); last.y1 = c.y; }
      else clusters.push({ side, role: role.label, dim: c.dim, items: [c], y0: c.y, y1: c.y });
    }
    const usedY = [];
    const clQty = (cl) => cl.items.reduce((a, c) => a + O[c.k][5], 0);
    const byQty = (x, y) => clQty(y) - clQty(x);
    for (const cl of clusters.filter((c) => !c.dim).sort(byQty).slice(0, 16)) { // 라운드트립을 골랐으면 그 주문들만 라벨
      const ym = (cl.y0 + cl.y1) / 2;
      if (usedY.some((u) => Math.abs(u - ym) < 12)) continue;
      usedY.push(ym);
      const os = cl.items.map((c) => O[c.k]);
      const qty = os.reduce((a, o) => a + o[5], 0), filled = os.reduce((a, o) => a + o[6], 0);
      const pct = qty ? Math.round((100 * filled) / qty) : 100;
      const len = Math.max(...cl.items.map((c) => c.len));
      const liq = os.some((o) => o[10] & 8);
      const sideTxt = cl.role;
      const txt = (os.length === 1
        ? `${sideTxt} ${usd(qty)}${pct < 100 ? ` ${pct}%` : ''} · ${hm(os[0][8])}${liq ? ' 강제청산' : ''}`
        : `${sideTxt} ${os.length}개 합 ${usd(qty)} · ${pct}% · ${nf(Math.min(...os.map((o) => o[2])), 0)}~${nf(Math.max(...os.map((o) => o[2])), 0)}`)
        + (cl.dim ? ' (선택 외)' : '');
      const tw = octx.measureText(txt).width;
      octx.fillStyle = 'rgba(14,17,22,.85)'; octx.fillRect(anchor - len - tw - 10, ym - 7, tw + 6, 14);
      octx.fillStyle = cl.dim ? 'rgba(139,149,163,.85)' : liq ? '#b388ff' : `rgb(${RGB[cl.side]})`;
      octx.textAlign = 'right'; octx.fillText(txt, anchor - len - 7, ym + 4); octx.textAlign = 'left';
    }
    octx.fillStyle = 'rgba(139,149,163,.9)'; octx.textAlign = 'right';
    octx.fillText(`사다리: 보이는 구간 주문 ${visOrders.length}개${sel != null ? ' · 선택한 라운드트립 것만 진하게' : ''}`, anchor, plotH - 8); octx.textAlign = 'left';
  }

  octx.restore();
}

/* ---------- 시작 ---------- */
readHash();
showView(state.view);
window.addEventListener('hashchange', () => { readHash(); showView(state.view); if (cur && cur.month !== state.month) loadMonth(state.month); });
