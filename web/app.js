const chartContainer = document.getElementById('chart');

const chart = LightweightCharts.createChart(chartContainer, {
  layout: { background: { color: '#000000' }, textColor: '#d1d4dc' },
  grid: {
    vertLines: { color: '#141414' },
    horzLines: { color: '#141414' }
  },
  timeScale: { borderColor: '#2a2e39' },
  rightPriceScale: { borderColor: '#2a2e39' }
});

// Buy (up) candles = white, Sell (down) candles = blue.
const candleSeries = chart.addCandlestickSeries({
  upColor: '#ffffff', downColor: '#2962ff',
  borderVisible: true,
  borderUpColor: '#ffffff', borderDownColor: '#2962ff',
  wickUpColor: '#ffffff', wickDownColor: '#2962ff'
});

function redrawAllOverlays() {
  if (typeof redrawTool === 'function') redrawTool();
  if (typeof redrawTrendLines === 'function') redrawTrendLines();
  if (typeof redrawRectangles === 'function') redrawRectangles();
}

function resizeChart() {
  chart.applyOptions({
    width: chartContainer.clientWidth,
    height: chartContainer.clientHeight
  });
  redrawAllOverlays();
}
window.addEventListener('resize', resizeChart);
resizeChart();

// ---- Resume-where-you-left-off (persisted in the browser via localStorage) ----
const STORAGE_KEY = 'xauusd_backtester_state_v1';
let stateRestored = false;

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveState() {
  try {
    const state = {
      tf: currentTf,
            replayIndex,      replayIndex,replayActive,
      replayIndex,
      trendLines: (typeof trendLines !== 'undefined') ? trendLines : [],
      rectangles: (typeof rectangles !== 'undefined') ? rectangles : [],
      placedTool: (typeof placedTool !== 'undefined') ? placedTool : null
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* storage full or unavailable - ignore, not critical */ }
}

const savedState = loadSavedState();

let currentTf = savedState && savedState.tf ? savedState.tf : '5M';
let fullData = [];

async function loadTimeframe(tf) {
  if (replayActive) exitReplay();
  currentTf = tf;
  document.querySelectorAll('.tf-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tf === tf);
  });
  const res = await fetch(`/api/candles?tf=${tf}`);
  const data = await res.json();
  fullData = data
    .map(c => ({ time: toChartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close }))
    .filter(c => !isNaN(c.time))
    .sort((a, b) => a.time - b.time);
  candleSeries.setData(fullData);
  chart.timeScale().fitContent();

  if (!stateRestored) {
    stateRestored = true;
    restoreSavedState();
  }

  redrawAllOverlays();
  if (typeof refreshTrading === 'function') refreshTrading();
  saveState();
}

function restoreSavedState() {
  if (!savedState) return;
  if (typeof trendLines !== 'undefined' && Array.isArray(savedState.trendLines)) {
    trendLines = savedState.trendLines;
  }
  if (typeof rectangles !== 'undefined' && Array.isArray(savedState.rectangles)) {
    rectangles = savedState.rectangles;
  }
  if (typeof placedTool !== 'undefined' && savedState.placedTool) {
    placedTool = savedState.placedTool;
    if (typeof buildToolOverlay === 'function') buildToolOverlay();
    if (typeof submitToolToBackend === 'function') submitToolToBackend();
  }
}

function toChartTime(raw) {
  const normalized = raw.replace(/\./g, '-').replace(' ', 'T') + 'Z';
  return Math.floor(Date.parse(normalized) / 1000);
}

document.querySelectorAll('.tf-btn').forEach(btn => {
  btn.addEventListener('click', () => loadTimeframe(btn.dataset.tf));
});

// ---- Bar Replay ----

let replayArmed = false;
let replayActive = false;
let replayIndex = -1;
let replayTimer = null;
let replayPlaying = false;
let replayPlayingReverse = false;

const replayBtn = document.getElementById('replayBtn');
const replayControls = document.getElementById('replayControls');
const replayPlayPauseBtn = document.getElementById('replayPlayPause');
const replayPlayReverseBtn = document.getElementById('replayPlayReverse');
const replayStepBackBtn = document.getElementById('replayStepBack');
const replayStepFwdBtn = document.getElementById('replayStepFwd');
const replayExitBtn = document.getElementById('replayExit');
const replaySpeedSelect = document.getElementById('replaySpeed');

replayBtn.addEventListener('click', () => {
  const turningOn = !replayArmed;
  if (typeof deactivateAllTools === 'function') deactivateAllTools();
  replayArmed = turningOn;
  replayBtn.classList.toggle('active', replayArmed);
});

function enterReplayAt(idx) {
  replayActive = true;
  replayArmed = false;
  replayBtn.classList.remove('active');
  replayIndex = idx;
  candleSeries.setData(fullData.slice(0, idx + 1));
  replayControls.classList.add('visible');
  updatePlayPauseIcon();
  redrawAllOverlays();
  if (typeof refreshTrading === 'function') refreshTrading();
  saveState();
}

function stepForward() {
  if (!replayActive) return;
  if (replayIndex + 1 >= fullData.length) { pauseReplay(); return; }
  replayIndex++;
  candleSeries.update(fullData[replayIndex]);
  redrawAllOverlays();
  if (typeof refreshTrading === 'function') refreshTrading();
  saveState();
}

function stepBackward() {
  if (!replayActive || replayIndex <= 0) return;
  replayIndex--;
  candleSeries.setData(fullData.slice(0, replayIndex + 1));
  redrawAllOverlays();
  if (typeof refreshTrading === 'function') refreshTrading();
  saveState();
}

// ---- Forward play ----
function playReplay() {
  if (replayPlaying) return;
  pauseReplayReverse();
  replayPlaying = true;
  updatePlayPauseIcon();
  const speed = parseInt(replaySpeedSelect.value, 10);
  replayTimer = setInterval(stepForward, speed);
}

function pauseReplay() {
  replayPlaying = false;
  updatePlayPauseIcon();
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
}

// ---- Reverse play (mirrors forward play, but steps backward) ----
function playReplayReverse() {
  if (replayPlayingReverse) return;
  pauseReplay();
  replayPlayingReverse = true;
  updatePlayPauseIcon();
  const speed = parseInt(replaySpeedSelect.value, 10);
  replayTimer = setInterval(() => {
    if (replayIndex <= 0) { pauseReplayReverse(); return; }
    stepBackward();
  }, speed);
}

function pauseReplayReverse() {
  replayPlayingReverse = false;
  updatePlayPauseIcon();
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
}

function updatePlayPauseIcon() {
  replayPlayPauseBtn.textContent = replayPlaying ? '⏸' : '▶';
  replayPlayPauseBtn.classList.toggle('active', replayPlaying);
  if (replayPlayReverseBtn) {
    replayPlayReverseBtn.textContent = replayPlayingReverse ? '⏸' : '◀';
    replayPlayReverseBtn.classList.toggle('active', replayPlayingReverse);
  }
}

function exitReplay() {
  pauseReplay();
  pauseReplayReverse();
  replayActive = false;
  replayIndex = -1;
  candleSeries.setData(fullData);
  chart.timeScale().fitContent();
  replayControls.classList.remove('visible');
  redrawAllOverlays();
  if (typeof refreshTrading === 'function') refreshTrading();
  saveState();
}

replayPlayPauseBtn.addEventListener('click', () => {
  if (replayPlaying) pauseReplay(); else playReplay();
});
if (replayPlayReverseBtn) {
  replayPlayReverseBtn.addEventListener('click', () => {
    if (replayPlayingReverse) pauseReplayReverse(); else playReplayReverse();
  });
}
replayStepBackBtn.addEventListener('click', () => { pauseReplay(); pauseReplayReverse(); stepBackward(); });
replayStepFwdBtn.addEventListener('click', () => { pauseReplay(); pauseReplayReverse(); stepForward(); });
replayExitBtn.addEventListener('click', exitReplay);
replaySpeedSelect.addEventListener('change', () => {
  if (replayPlaying) { pauseReplay(); playReplay(); }
  if (replayPlayingReverse) { pauseReplayReverse(); playReplayReverse(); }
});

// ---- Jump to a chosen date: starts the session right there ----
function jumpToDate(dateStr) {
  if (!dateStr || !fullData.length) return;
  const target = Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 1000);
  let idx = fullData.findIndex(c => c.time >= target);
  if (idx === -1) idx = fullData.length - 1;
  if (typeof deactivateAllTools === 'function') deactivateAllTools();
  replayArmed = false;
  replayBtn.classList.remove('active');
  enterReplayAt(idx);
}

const jumpDateInput = document.getElementById('jumpDateInput');
const jumpDateBtn = document.getElementById('jumpDateBtn');
if (jumpDateBtn) {
  jumpDateBtn.addEventListener('click', () => jumpToDate(jumpDateInput.value));
}

// ---- Chart click: place tool OR pick replay start ----

chart.subscribeClick(param => {
  if (replayArmed) {
    if (!param.time) return;
    const idx = fullData.findIndex(c => c.time === param.time);
    if (idx === -1) return;
    enterReplayAt(idx);
    return;
  }
  if (typeof handleToolClick === 'function') handleToolClick(param);
});

chart.timeScale().subscribeVisibleLogicalRangeChange(() => redrawAllOverlays());

// Save whenever the app is backgrounded/minimized/closed, so it resumes
// from the same place next time it's opened.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveState();
});
window.addEventListener('pagehide', saveState);
window.addEventListener('beforeunload', saveState);

loadTimeframe(currentTf);
