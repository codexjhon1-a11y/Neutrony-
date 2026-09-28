// ---- Tools: Long/Short position tool, Trend Line, Rectangle ----

let activeTool = null;
let placedTool = null;
let dragging = null;
let lastToolResult = null;

const overlay = document.getElementById('toolOverlay');
const drawOverlay = document.getElementById('drawOverlay');

const longBtn = document.getElementById('longToolBtn');
const shortBtn = document.getElementById('shortToolBtn');
const trendLineBtn = document.getElementById('trendLineBtn');
const rectBtn = document.getElementById('rectBtn');

let trendLineArmed = false;
let rectArmed = false;
let trendLines = [];
let rectangles = [];
let pendingTrendPoint = null;
let pendingRectPoint = null;

// Resolves a click into a chart Time value even when the click landed on
// "whitespace" (past the last candle, or in the chart's right-side margin).
// chart.subscribeClick's own param.time is undefined there, which used to
// make Trend Line / Rectangle silently do nothing on any click that wasn't
// exactly on top of a candle - coordinateToTime() extrapolates correctly
// even in that empty space, so we always get a usable time back.
function resolveClickTime(param) {
  if (param.time) return param.time;
  if (!param.point) return null;
  return chart.timeScale().coordinateToTime(param.point.x);
}

// Small dot shown after the first click of a 2-click tool (Trend Line /
// Rectangle) so it's obvious the click registered and a second click is
// needed - without this there was zero feedback, which is why it looked
// completely broken.
function drawPendingMarker(point, color) {
  clearPendingMarker();
  if (!point) return;
  const x = chart.timeScale().timeToCoordinate(point.time);
  const y = candleSeries.priceToCoordinate(point.price);
  if (x === null || y === null) return;
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('class', 'user-pending');
  dot.setAttribute('cx', x);
  dot.setAttribute('cy', y);
  dot.setAttribute('r', 5);
  dot.setAttribute('fill', color);
  drawOverlay.appendChild(dot);
}

function clearPendingMarker() {
  drawOverlay.querySelectorAll('.user-pending').forEach(el => el.remove());
}

// Esc cancels whatever 2-click tool is half-placed (instead of it being
// stuck waiting for a second click with no way out but reloading the page),
// and also clears an already-placed Long/Short box - there was previously
// no way to remove one once placed except overwriting it with a new one.
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (pendingTrendPoint || pendingRectPoint) {
    pendingTrendPoint = null;
    pendingRectPoint = null;
    clearPendingMarker();
    return;
  }
  if (placedTool) {
    placedTool = null;
    overlay.innerHTML = '';
    lastToolResult = null;
    if (typeof saveState === 'function') saveState();
  }
});

function deactivateAllTools() {
  activeTool = null;
  trendLineArmed = false;
  rectArmed = false;
  pendingTrendPoint = null;
  pendingRectPoint = null;
  clearPendingMarker();
  longBtn.classList.remove('active');
  shortBtn.classList.remove('active');
  trendLineBtn.classList.remove('active');
  rectBtn.classList.remove('active');
  if (typeof replayBtn !== 'undefined') replayBtn.classList.remove('active');
  if (typeof replayArmed !== 'undefined') replayArmed = false;
}

longBtn.addEventListener('click', () => {
  const turningOn = activeTool !== 'long';
  deactivateAllTools();
  if (turningOn) {
    activeTool = 'long';
    longBtn.classList.add('active');
  }
});

shortBtn.addEventListener('click', () => {
  const turningOn = activeTool !== 'short';
  deactivateAllTools();
  if (turningOn) {
    activeTool = 'short';
    shortBtn.classList.add('active');
  }
});

trendLineBtn.addEventListener('click', () => {
  const turningOn = !trendLineArmed;
  deactivateAllTools();
  if (turningOn) {
    trendLineArmed = true;
    trendLineBtn.classList.add('active');
  }
});

rectBtn.addEventListener('click', () => {
  const turningOn = !rectArmed;
  deactivateAllTools();
  if (turningOn) {
    rectArmed = true;
    rectBtn.classList.add('active');
  }
});

// ---- Dispatcher called from app.js's chart click handler ----
function handleToolClick(param) {
  if (trendLineArmed) { handleTrendLineClick(param); return; }
  if (rectArmed) { handleRectClick(param); return; }
  if (!activeTool || !param.point) return;

  const price = candleSeries.coordinateToPrice(param.point.y);
  if (price === null) return;

  placedTool = activeTool === 'long'
    ? { type: 'long', entry: price, stop: price * 0.995, target: price * 1.01 }
    : { type: 'short', entry: price, stop: price * 1.005, target: price * 0.99 };

  activeTool = null;
  longBtn.classList.remove('active');
  shortBtn.classList.remove('active');

  buildToolOverlay();
  submitToolToBackend();
  if (typeof saveState === 'function') saveState();
}

// ---- Long/Short position box ----
function buildToolOverlay() {
  overlay.innerHTML = '';
  if (!placedTool) return;

  ['entry', 'stop', 'target'].forEach(key => {
    const line = document.createElement('div');
    line.className = `tool-line ${key}`;
    line.dataset.key = key;
    line.addEventListener('mousedown', e => { dragging = key; e.preventDefault(); });
    line.addEventListener('touchstart', () => { dragging = key; }, { passive: true });
    overlay.appendChild(line);

    const label = document.createElement('div');
    label.className = `tool-label ${key}`;
    label.dataset.key = key;
    overlay.appendChild(label);
  });

  const profitZone = document.createElement('div');
  profitZone.className = 'tool-zone profit';
  profitZone.dataset.zone = 'profit';
  overlay.appendChild(profitZone);

  const lossZone = document.createElement('div');
  lossZone.className = 'tool-zone loss';
  lossZone.dataset.zone = 'loss';
  overlay.appendChild(lossZone);

  const badge = document.createElement('div');
  badge.id = 'rrBadge';
  overlay.appendChild(badge);

  redrawTool();
}

function redrawTool() {
  if (!placedTool) return;
  const entryY = candleSeries.priceToCoordinate(placedTool.entry);
  const stopY = candleSeries.priceToCoordinate(placedTool.stop);
  const targetY = candleSeries.priceToCoordinate(placedTool.target);
  if (entryY === null || stopY === null || targetY === null) return;

  positionLine('entry', entryY, placedTool.entry);
  positionLine('stop', stopY, placedTool.stop);
  positionLine('target', targetY, placedTool.target);

  const profitTop = placedTool.type === 'long' ? targetY : entryY;
  const profitBottom = placedTool.type === 'long' ? entryY : targetY;
  const lossTop = placedTool.type === 'long' ? entryY : stopY;
  const lossBottom = placedTool.type === 'long' ? stopY : entryY;

  positionZone('profit', profitTop, profitBottom);
  positionZone('loss', lossTop, lossBottom);

  const badge = document.getElementById('rrBadge');
  if (badge) {
    // Show the backend's R:R once it responds; until then (or if the
    // backend call fails) compute it locally so the readout never blanks.
    const rr = lastToolResult ? lastToolResult.riskRewardRatio : localRiskReward(placedTool);
    badge.textContent = `${placedTool.type.toUpperCase()}  R:R ${isFinite(rr) ? rr.toFixed(2) : '-'}`;
  }
}

function localRiskReward(tool) {
  const risk = Math.abs(tool.entry - tool.stop);
  const reward = Math.abs(tool.target - tool.entry);
  return risk === 0 ? Infinity : reward / risk;
}

function positionLine(key, y, price) {
  const line = overlay.querySelector(`.tool-line[data-key="${key}"]`);
  const label = overlay.querySelector(`.tool-label[data-key="${key}"]`);
  if (line) line.style.top = `${y}px`;
  if (label) {
    label.style.top = `${y}px`;
    label.textContent = `${key.toUpperCase()} ${price.toFixed(2)}`;
  }
}

function positionZone(zoneName, top, bottom) {
  const zone = overlay.querySelector(`.tool-zone[data-zone="${zoneName}"]`);
  if (!zone) return;
  zone.style.top = `${Math.min(top, bottom)}px`;
  zone.style.height = `${Math.abs(bottom - top)}px`;
}

window.addEventListener('mousemove', e => handleDragMove(e.clientY));
window.addEventListener('touchmove', e => {
  if (dragging && e.touches.length) handleDragMove(e.touches[0].clientY);
}, { passive: true });
window.addEventListener('mouseup', handleDragEnd);
window.addEventListener('touchend', handleDragEnd);

function handleDragMove(clientY) {
  if (!dragging || !placedTool) return;
  const rect = chartContainer.getBoundingClientRect();
  const price = candleSeries.coordinateToPrice(clientY - rect.top);
  if (price === null) return;
  placedTool[dragging] = price;
  redrawTool();
}

function handleDragEnd() {
  if (!dragging) return;
  dragging = null;
  submitToolToBackend();
  if (typeof saveState === 'function') saveState();
}

async function submitToolToBackend() {
  if (!placedTool) return;
  const res = await fetch('/api/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(placedTool)
  });
  lastToolResult = await res.json();
  redrawTool();
}

// ---- Trend Line ----
function handleTrendLineClick(param) {
  if (!param.point) return;
  const time = resolveClickTime(param);
  if (time === null) return;
  const price = candleSeries.coordinateToPrice(param.point.y);
  if (price === null) return;
  if (!pendingTrendPoint) {
    pendingTrendPoint = { time, price };
    drawPendingMarker(pendingTrendPoint, '#ab47bc');
  } else {
    trendLines.push({ p1: pendingTrendPoint, p2: { time, price } });
    pendingTrendPoint = null;
    clearPendingMarker();
    trendLineArmed = false;
    trendLineBtn.classList.remove('active');
    redrawTrendLines();
    if (typeof saveState === 'function') saveState();
  }
}

function redrawTrendLines() {
  const old = drawOverlay.querySelectorAll('.user-trendline');
  old.forEach(el => el.remove());
  trendLines.forEach(line => {
    const x1 = chart.timeScale().timeToCoordinate(line.p1.time);
    const y1 = candleSeries.priceToCoordinate(line.p1.price);
    const x2 = chart.timeScale().timeToCoordinate(line.p2.time);
    const y2 = candleSeries.priceToCoordinate(line.p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return;
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    el.setAttribute('class', 'user-trendline');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    el.setAttribute('stroke', '#ab47bc');
    el.setAttribute('stroke-width', '2');
    drawOverlay.appendChild(el);
  });
}

// ---- Rectangle ----
function handleRectClick(param) {
  if (!param.point) return;
  const time = resolveClickTime(param);
  if (time === null) return;
  const price = candleSeries.coordinateToPrice(param.point.y);
  if (price === null) return;
  if (!pendingRectPoint) {
    pendingRectPoint = { time, price };
    drawPendingMarker(pendingRectPoint, '#ffb300');
  } else {
    rectangles.push({ p1: pendingRectPoint, p2: { time, price } });
    pendingRectPoint = null;
    clearPendingMarker();
    rectArmed = false;
    rectBtn.classList.remove('active');
    redrawRectangles();
    if (typeof saveState === 'function') saveState();
  }
}

function redrawRectangles() {
  const old = drawOverlay.querySelectorAll('.user-rect');
  old.forEach(el => el.remove());
  rectangles.forEach(r => {
    const x1 = chart.timeScale().timeToCoordinate(r.p1.time);
    const x2 = chart.timeScale().timeToCoordinate(r.p2.time);
    const y1 = candleSeries.priceToCoordinate(r.p1.price);
    const y2 = candleSeries.priceToCoordinate(r.p2.price);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'user-rect');
    rect.setAttribute('x', Math.min(x1, x2));
    rect.setAttribute('y', Math.min(y1, y2));
    rect.setAttribute('width', Math.abs(x2 - x1));
    rect.setAttribute('height', Math.abs(y2 - y1));
    rect.setAttribute('fill', 'rgba(255,179,0,0.14)');
    rect.setAttribute('stroke', '#ffb300');
    rect.setAttribute('stroke-width', '1.5');
    drawOverlay.appendChild(rect);
  });
}

