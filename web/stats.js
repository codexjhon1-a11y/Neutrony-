// Reads the same localStorage key trading.js writes to (web/index.html and
// web/stats.html are separate pages, so this is the only thing connecting
// them - no backend involved).
const TRADING_KEY = 'xauusd_trading_v1';
const STARTING_CAPITAL = 5000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function loadState() {
  try {
    const raw = localStorage.getItem(TRADING_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* corrupt/unavailable - fall through to empty state */ }
  return { capital: STARTING_CAPITAL, openPositions: [], closedTrades: [], nextId: 1 };
}

function formatDuration(sec) {
  if (!sec || sec <= 0) return '< 1m';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function card(label, value, cls) {
  return `<div class="stat-card"><div class="label">${label}</div><div class="value ${cls || ''}">${value}</div></div>`;
}

function render() {
  const state = loadState();
  const trades = state.closedTrades || [];
  const cardsEl = document.getElementById('statsCards');
  const dayEl = document.getElementById('dayTable');
  const bodyEl = document.getElementById('historyBody');

  // ---- Summary cards ----
  const total = trades.length;
  const wins = trades.filter(t => t.win).length;
  const losses = total - wins;
  const winRate = total ? (wins / total * 100) : 0;
  const avgRR = total ? trades.reduce((s, t) => s + t.rr, 0) / total : 0;
  const winningTrades = trades.filter(t => t.win);
  const avgWinRR = winningTrades.length
    ? winningTrades.reduce((s, t) => s + t.rr, 0) / winningTrades.length : 0;
  const avgDuration = total ? trades.reduce((s, t) => s + t.durationSec, 0) / total : 0;
  const capitalDelta = state.capital - STARTING_CAPITAL;

  cardsEl.innerHTML = [
    card('Capital', `$${state.capital.toFixed(2)}`, capitalDelta >= 0 ? 'up' : 'down'),
    card('P&amp;L', `${capitalDelta >= 0 ? '+' : ''}$${capitalDelta.toFixed(2)}`, capitalDelta >= 0 ? 'up' : 'down'),
    card('Total Trades', total),
    card('Win Rate', `${winRate.toFixed(1)}%`, winRate >= 50 ? 'up' : 'down'),
    card('Wins / Losses', `${wins} / ${losses}`),
    card('Avg R:R (all)', avgRR.toFixed(2)),
    card('Avg R:R (wins)', avgWinRR.toFixed(2)),
    card('Avg Trade Duration', formatDuration(avgDuration))
  ].join('');

  // ---- Win rate by day of week ----
  const byDay = DAY_NAMES.map(() => ({ total: 0, wins: 0 }));
  trades.forEach(t => {
    const day = new Date(t.openTime * 1000).getUTCDay();
    byDay[day].total++;
    if (t.win) byDay[day].wins++;
  });

  dayEl.innerHTML = byDay.map((d, i) => {
    const pct = d.total ? (d.wins / d.total * 100) : 0;
    const noTrades = d.total === 0;
    return `
      <div class="day-row ${noTrades ? 'no-trades' : ''}">
        <div class="day-name">${DAY_NAMES[i]}</div>
        <div class="day-bar-track"><div class="day-bar-fill" style="width:${pct}%"></div></div>
        <div class="day-stats">${noTrades ? 'no trades' : `${pct.toFixed(0)}% (${d.wins}/${d.total})`}</div>
      </div>`;
  }).join('');

  // ---- Trade history table ----
  if (!trades.length) {
    bodyEl.innerHTML = '<tr><td colspan="8" class="empty-msg">No closed trades yet — go place some BUY/SELL trades on the chart.</td></tr>';
  } else {
    bodyEl.innerHTML = trades.slice().reverse().map(t => {
      const dayName = DAY_NAMES[new Date(t.openTime * 1000).getUTCDay()];
      return `
        <tr>
          <td class="dir-${t.direction}">${t.direction}</td>
          <td>${t.lot.toFixed(2)}</td>
          <td>${t.entry.toFixed(2)}</td>
          <td>${t.exit.toFixed(2)}</td>
          <td class="${t.pnl >= 0 ? 'pnl-up' : 'pnl-down'}">${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</td>
          <td>${t.rr.toFixed(2)}</td>
          <td>${dayName}</td>
          <td>${formatDuration(t.durationSec)}</td>
        </tr>`;
    }).join('');
  }
}

document.getElementById('statsReset').addEventListener('click', () => {
  if (!confirm('Clear all trade history and reset capital to $5000?')) return;
  localStorage.setItem(TRADING_KEY, JSON.stringify({
    capital: STARTING_CAPITAL, openPositions: [], closedTrades: [], nextId: 1
  }));
  render();
});

render();
