// ---- Paper trading: BUY/SELL against $5000 starting capital ----
// Everything lives in localStorage (shared with stats.html) since this is
// a single-user, no-backend-database tool.

const TRADING_KEY = 'xauusd_trading_v1';
const STARTING_CAPITAL = 5000;
const SPREAD = 0.25;
const PIP_VALUE_PER_LOT = 100;  // $ per 1.00 price move per 1.00 lot

const capitalBox = document.getElementById('capitalBox');
const capitalVal = document.getElementById('capitalVal');
const lotInput = document.getElementById('lotInput');
const sellBtn = document.getElementById('sellBtn');
const buyBtn = document.getElementById('buyBtn');
const sellPriceEl = document.getElementById('sellPrice');
const buyPriceEl = document.getElementById('buyPrice');
const positionsListEl = document.getElementById('positionsList');

const orderModal = document.getElementById('orderModal');
const orderTitle = document.getElementById('orderTitle');
const orderSl = document.getElementById('orderSl');
const orderTp = document.getElementById('orderTp');
const orderInfo = document.getElementById('orderInfo');
const orderCancel = document.getElementById('orderCancel');
const orderConfirm = document.getElementById('orderConfirm');

function loadTradingState() {
  try {
    const raw = localStorage.getItem(TRADING_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* start fresh */ }
  return { capital: STARTING_CAPITAL, openPositions: [], closedTrades: [], nextId: 1 };
}

let tradingState = loadTradingState();

function saveTradingState() {
  try { localStorage.setItem(TRADING_KEY, JSON.stringify(tradingState)); }
  catch (e) { /* not critical */ }
}

function currentIndex() {
  if (typeof replayActive !== 'undefined' && replayActive &&
      typeof replayIndex !== 'undefined' && replayIndex >= 0) return replayIndex;
  if (typeof fullData !== 'undefined') return fullData.length - 1;
  return -1;
}

function currentMarketCandle() {
  const i = currentIndex();
  if (i >= 0 && fullData[i]) return fullData[i];
  return null;
}

function pnlOf(pos, exitPrice) {
  const diff = pos.direction === 'BUY' ? (exitPrice - pos.entry) : (pos.entry - exitPrice);
  return diff * pos.lot * PIP_VALUE_PER_LOT;
}

// ---------- small toast (SL / TP hit messages) ----------
function showToast(text, good) {
  const el = document.createElement('div');
  el.textContent = text;
  el.className = 'toast ' + (good ? 'up' : 'down');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ---------- order popup: choose SL and TP before the trade opens ----------
let pendingDirection = null;
let pendingEntry = 0;
let lastSlDist = 5;
let lastTpDist = 10;

function pendingLot() {
  return Math.max(0.01, parseFloat(lotInput.value) || 0.10);
}

function openOrderModal(direction) {
  const candle = currentMarketCandle();
  if (!candle) return;
  const entry = direction === 'BUY' ? candle.close + SPREAD : candle.close - SPREAD;
  pendingDirection = direction;
  pendingEntry = entry;
  orderTitle.textContent = `${direction} ${pendingLot().toFixed(2)} lot @ ${entry.toFixed(2)}`;
  orderTitle.className = direction;
  const sign = direction === 'BUY' ? -1 : 1;
  orderSl.value = (entry + sign * lastSlDist).toFixed(2);
  orderTp.value = (entry - sign * lastTpDist).toFixed(2);
  updateOrderInfo();
  orderModal.classList.remove('hidden');
}

function closeOrderModal() {
  orderModal.classList.add('hidden');
  pendingDirection = null;
}

function readOrderLevels() {
  const sl = parseFloat(orderSl.value);
  const tpRaw = orderTp.value.trim();
  const tp = tpRaw === '' ? null : parseFloat(tpRaw);
  return { sl: isNaN(sl) ? null : sl, tp: (tp !== null && isNaN(tp)) ? null : tp };
}

function validateOrder() {
  const { sl, tp } = readOrderLevels();
  const buy = pendingDirection === 'BUY';
  if (sl === null) return 'Stop Loss daalo';
  if (buy && sl >= pendingEntry) return 'BUY me SL entry se neeche hona chahiye';
  if (!buy && sl <= pendingEntry) return 'SELL me SL entry se upar hona chahiye';
  if (tp !== null) {
    if (buy && tp <= pendingEntry) return 'BUY me TP entry se upar hona chahiye';
    if (!buy && tp >= pendingEntry) return 'SELL me TP entry se neeche hona chahiye';
  }
  return '';
}

function updateOrderInfo() {
  const err = validateOrder();
  const { sl, tp } = readOrderLevels();
  const lot = pendingLot();
  orderConfirm.disabled = !!err;
  if (err) { orderInfo.textContent = err; orderInfo.className = 'error'; return; }
  const risk = Math.abs(pendingEntry - sl) * lot * PIP_VALUE_PER_LOT;
  let text = `Risk $${risk.toFixed(2)}`;
  if (tp !== null) {
    const reward = Math.abs(tp - pendingEntry) * lot * PIP_VALUE_PER_LOT;
    text += ` · Reward $${reward.toFixed(2)} · RR 1:${(reward / risk).toFixed(2)}`;
  } else {
    text += ' · TP nahi (manual close)';
  }
  orderInfo.textContent = text;
  orderInfo.className = '';
}

function confirmOrder() {
  if (!pendingDirection || validateOrder()) return;
  const { sl, tp } = readOrderLevels();
  const candle = currentMarketCandle();
  if (!candle) return;
  lastSlDist = Math.abs(pendingEntry - sl);
  if (tp !== null) lastTpDist = Math.abs(tp - pendingEntry);

  tradingState.openPositions.push({
    id: tradingState.nextId++,
    direction: pendingDirection,
    lot: pendingLot(),
    entry: pendingEntry,
    stop: sl,
    target: tp,
    openTime: candle.time,
    checkedTime: candle.time
  });
  saveTradingState();
  closeOrderModal();
  renderPositions();
}

// ---------- closing ----------
// exitPrice/closeTime/reason are optional: manual close uses the current
// candle's close; auto close (SL/TP) passes the exact SL/TP price.
function closePosition(id, exitPrice, closeTimeArg, reason) {
  const idx = tradingState.openPositions.findIndex(p => p.id === id);
  if (idx === -1) return;
  const pos = tradingState.openPositions[idx];
  const candle = currentMarketCandle();
  const exit = (typeof exitPrice === 'number') ? exitPrice : (candle ? candle.close : pos.entry);
  const closeTime = (typeof closeTimeArg === 'number') ? closeTimeArg : (candle ? candle.time : pos.openTime);

  const pnl = pnlOf(pos, exit);
  const riskPerUnit = Math.abs(pos.entry - pos.stop);
  const rewardPerUnit = pos.direction === 'BUY' ? (exit - pos.entry) : (pos.entry - exit);
  const rr = riskPerUnit !== 0 ? rewardPerUnit / riskPerUnit : 0;

  tradingState.closedTrades.push({
    id: pos.id, direction: pos.direction, lot: pos.lot,
    entry: pos.entry, exit, stop: pos.stop, target: pos.target,
    openTime: pos.openTime, closeTime,
    durationSec: Math.max(0, closeTime - pos.openTime),
    pnl: Math.round(pnl * 100) / 100,
    rr: Math.round(rr * 100) / 100,
    win: pnl > 0,
    closedBy: reason || 'MANUAL'
  });
  tradingState.capital = Math.round((tradingState.capital + pnl) * 100) / 100;
  tradingState.openPositions.splice(idx, 1);

  saveTradingState();
  renderCapital();
  renderPositions();
  if (reason) {
    const sign = pnl >= 0 ? '+' : '';
    showToast(`${reason} hit · ${pos.direction} ${sign}$${pnl.toFixed(2)}`, pnl >= 0);
  }
}

// Walks the candles that appeared since each position was last checked and
// closes it at the SL/TP price if touched. If SL and TP are both touched
// inside the same candle, SL is assumed to have hit first (conservative).
// Only runs while replay is active - that's the backtest.
function checkSlTp() {
  if (!tradingState.openPositions.length) return;
  if (typeof fullData === 'undefined' || !fullData.length) return;
  const curIdx = currentIndex();
  if (curIdx < 0) return;

  tradingState.openPositions.slice().forEach(pos => {
    const from = (typeof pos.checkedTime === 'number') ? pos.checkedTime : pos.openTime;
    let start = curIdx;
    while (start >= 0 && fullData[start].time > from) start--;
    start++;
    for (let i = start; i <= curIdx; i++) {
      const c = fullData[i];
      const buy = pos.direction === 'BUY';
      const hitSl = pos.stop != null && (buy ? c.low <= pos.stop : c.high >= pos.stop);
      const hitTp = pos.target != null && (buy ? c.high >= pos.target : c.low <= pos.target);
      if (hitSl || hitTp) {
        closePosition(pos.id, hitSl ? pos.stop : pos.target, c.time, hitSl ? 'SL' : 'TP');
        return;
      }
    }
    const curTime = fullData[curIdx].time;
    if (curTime > from) { pos.checkedTime = curTime; saveTradingState(); }
  });
}

// ---------- rendering ----------
function renderCapital() {
  capitalVal.textContent = `$${tradingState.capital.toFixed(2)}`;
  capitalBox.classList.toggle('up', tradingState.capital > STARTING_CAPITAL);
  capitalBox.classList.toggle('down', tradingState.capital < STARTING_CAPITAL);
}

function renderTradePrices() {
  const candle = currentMarketCandle();
  if (!candle) return;
  sellPriceEl.textContent = (candle.close - SPREAD).toFixed(2);
  buyPriceEl.textContent = (candle.close + SPREAD).toFixed(2);
}

// Entry / SL / TP lines on the chart for every open position.
let priceLines = [];
let priceLinesSig = '';
function syncPriceLines() {
  if (typeof candleSeries === 'undefined') return;
  const sig = tradingState.openPositions
    .map(p => `${p.id}:${p.entry}:${p.stop}:${p.target}`).join('|');
  if (sig === priceLinesSig) return;
  priceLinesSig = sig;
  priceLines.forEach(l => { try { candleSeries.removePriceLine(l); } catch (e) {} });
  priceLines = [];
  tradingState.openPositions.forEach(pos => {
    const add = (price, color, title, style) => {
      if (price == null) return;
      try {
        priceLines.push(candleSeries.createPriceLine({
          price, color, lineWidth: 1, lineStyle: style,
          axisLabelVisible: true, title
        }));
      } catch (e) { /* chart lib issue - lines are cosmetic */ }
    };
    add(pos.entry, '#9e9e9e', `${pos.direction} ${pos.lot.toFixed(2)}`, 2);
    add(pos.stop, '#f23645', 'SL', 0);
    add(pos.target, '#089981', 'TP', 0);
  });
}

function renderPositions() {
  const candle = currentMarketCandle();
  const market = candle ? candle.close : null;
  positionsListEl.innerHTML = '';

  tradingState.openPositions.forEach(pos => {
    const pnl = market !== null ? pnlOf(pos, market) : 0;
    const row = document.createElement('div');
    row.className = 'pos-row';
    const levels = `SL ${pos.stop.toFixed(2)}` +
      (pos.target != null ? ` · TP ${pos.target.toFixed(2)}` : '');
    row.innerHTML = `
      <div class="pos-info">
        <span class="pos-dir ${pos.direction}">${pos.direction} ${pos.lot.toFixed(2)}</span>
        <span>@ ${pos.entry.toFixed(2)}</span>
        <span class="pos-levels">${levels}</span>
        <span class="pos-pnl ${pnl >= 0 ? 'up' : 'down'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>
      </div>
      <button data-id="${pos.id}" title="Close">✕</button>
    `;
    row.querySelector('button').addEventListener('click', () => closePosition(pos.id));
    positionsListEl.appendChild(row);
  });
  syncPriceLines();
}

// Called from app.js whenever the market price/time can change.
function refreshTrading() {
  if (typeof replayActive !== 'undefined' && replayActive) checkSlTp();
  renderTradePrices();
  renderPositions();
}

buyBtn.addEventListener('click', () => openOrderModal('BUY'));
sellBtn.addEventListener('click', () => openOrderModal('SELL'));
orderSl.addEventListener('input', updateOrderInfo);
orderTp.addEventListener('input', updateOrderInfo);
orderCancel.addEventListener('click', closeOrderModal);
orderConfirm.addEventListener('click', confirmOrder);

renderCapital();
refreshTrading();
