/* Two-page app: setup -> game logic adapted to populate rope labels
   Updated: use per-rope positions & per-rope power so each end-button affects only its rope. */

const qs = s => document.querySelector(s);

// Setup page elements
const pageSetup = qs('#page-setup');
const pageGame = qs('#page-game');
const form = qs('#values-form');
const inputs = Array.from(document.querySelectorAll('.value-input, .value-input-modern'));
const toGameBtn = qs('#to-game-btn');

// Game elements (will be created)

const timerEl = qs('#timer');
const startBtn = qs('#start-btn');
const durationSelect = qs('#duration-select');
const toast = qs('#toast');

let flagEls = [];
let leftBtn, rightBtn;
let width = null;

// per-rope state arrays
let positions = [];       // values 0..1 for each rope
let leftPowers = [];      // accumulating left pulls per rope
let rightPowers = [];     // accumulating right pulls per rope

let running = false;
let roundTime = 30;
let timeLeft = 0;
let lastTick = 0;
let raf = null;
let leftScore = 0;
let rightScore = 0;

/* format seconds as MM:SS for a digital clock-style display */
function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// helper
function showToast(text, ms = 1200) {
  toast.textContent = text;
  toast.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.display = 'none' }, ms);
}

// validate inputs and enable button when all non-empty
function validateInputs() {
  const allFilled = inputs.every(i => i.value.trim().length > 0);
  toGameBtn.disabled = !allFilled;
}

/* build rope rows based on inputs
   Ensure each end-button is explicitly enabled, focusable and exposes aria-pressed
   so all 12 per-rope buttons are individually active and accessible. */
function buildRopes(values) {
  const container = qs('#rope-row');
  container.innerHTML = '';
  for (let i = 0; i < values.length; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'rope-wrapper';
    // left end lever
    const left = createLever('left');

    // rope
    const rope = document.createElement('div');
    rope.className = 'rope';
    const flag = document.createElement('div');
    flag.className = 'flag';
    flag.textContent = values[i];
    rope.appendChild(flag);

    // right end lever
    const right = createLever('right');
    wrapper.appendChild(left);
    wrapper.appendChild(rope);
    wrapper.appendChild(right);
    container.appendChild(wrapper);
  }

  // wire up references
  flagEls = Array.from(document.querySelectorAll('.flag'));
  leftBtn = qs('#left-btn');
  rightBtn = qs('#right-btn');

  // initialize per-rope state
  positions = new Array(flagEls.length).fill(0.5);
  leftPowers = new Array(flagEls.length).fill(0);
  rightPowers = new Array(flagEls.length).fill(0);

  // wire small end buttons for per-rope interaction (map each button to its rope index)
  const leftButtons = Array.from(document.querySelectorAll('.rope-pull.left-small'));
  const rightButtons = Array.from(document.querySelectorAll('.rope-pull.right-small'));
  wireSmallButtons(leftButtons, 'left');
  wireSmallButtons(rightButtons, 'right');

  updateWidth();
  renderFlag();
  updateBlockedStates();
}

// Helper to create the generic Lever Switch structure
// Returns the .toggle-container element which acts as the button
function createLever(side) {
  /*
  <div class="toggle-container" data-side="left/right" role="button" tabindex="0">
    <div class="toggle-base">
      <div class="toggle-base-inside"></div>
    </div>
    <div class="toggle-handle-wrapper">
      <div class="toggle-handle">
        <div class="toggle-handle-knob"></div>
        <div class="toggle-handle-bar-wrapper">
          <div class="toggle-handle-bar"></div>
        </div>
      </div>
    </div>
  </div>
  */
  const container = document.createElement('div');
  container.className = 'toggle-container rope-pull ' + (side === 'left' ? 'left-small' : 'right-small');
  container.dataset.side = side;
  container.role = 'button';
  container.tabIndex = 0;
  container.setAttribute('aria-pressed', 'false');

  // Base
  const base = document.createElement('div');
  base.className = 'toggle-base';
  const baseInside = document.createElement('div');
  baseInside.className = 'toggle-base-inside';
  base.appendChild(baseInside);
  container.appendChild(base);

  // Handle
  const wrapper = document.createElement('div');
  wrapper.className = 'toggle-handle-wrapper';
  const handle = document.createElement('div');
  handle.className = 'toggle-handle';

  const knob = document.createElement('div');
  knob.className = 'toggle-handle-knob';

  const barWrapper = document.createElement('div');
  barWrapper.className = 'toggle-handle-bar-wrapper';
  const bar = document.createElement('div');
  bar.className = 'toggle-handle-bar';

  barWrapper.appendChild(bar);
  handle.appendChild(knob);
  handle.appendChild(barWrapper);
  wrapper.appendChild(handle);
  container.appendChild(wrapper);

  return container;
}

// responsive width
function updateWidth() {
  const container = document.querySelector('.rope');
  if (container) width = container.getBoundingClientRect().width;
}

/* apply flag position to all flags (per-rope positions) */
function renderFlag() {
  flagEls.forEach((f, i) => {
    const pct = Math.max(0, Math.min(1, positions[i])) * 100;
    f.style.left = pct + '%';
  });
}

/* update per-rope blocked visual states:
   - If a side already has 3 secured ropes (left <0.3 or right >0.7),
     then ropes that are NOT already secured for that side become 'blocked' for that side:
     we add .blocked on the corresponding end-button and mark the wrapper with blocked-left/right for optional badge.
*/
function updateBlockedStates() {
  const wrappers = Array.from(document.querySelectorAll('.rope-wrapper'));
  if (!wrappers.length) return;
  // only count ropes as secured when they are fully at the edge (0 or 1)
  const leftSecured = positions.filter(p => p === 0).length;
  const rightSecured = positions.filter(p => p === 1).length;

  wrappers.forEach((wrap, i) => {
    const leftBtn = wrap.querySelector('.rope-pull.left-small');
    const rightBtn = wrap.querySelector('.rope-pull.right-small');

    // determine if this rope is secured for left/right (only fully-at-edge counts)
    const securedLeft = positions[i] === 0;
    const securedRight = positions[i] === 1;

    // by default remove blocked classes
    leftBtn && leftBtn.classList.remove('blocked');
    rightBtn && rightBtn.classList.remove('blocked');
    wrap.classList.remove('blocked-left', 'blocked-right');

    // if left already has 3 secured and this rope is not secured to left, mark left button blocked
    if (leftSecured >= 3 && !securedLeft) {
      leftBtn && leftBtn.classList.add('blocked');
      wrap.classList.add('blocked-left');
      // keep aria-disabled for screen readers so user knows it's effectively blocked
      leftBtn && leftBtn.setAttribute('aria-disabled', 'true');
    } else {
      leftBtn && leftBtn.setAttribute('aria-disabled', 'false');
    }

    // if right already has 3 secured and this rope is not secured to right, mark right button blocked
    if (rightSecured >= 3 && !securedRight) {
      rightBtn && rightBtn.classList.add('blocked');
      wrap.classList.add('blocked-right');
      rightBtn && rightBtn.setAttribute('aria-disabled', 'true');
    } else {
      rightBtn && rightBtn.setAttribute('aria-disabled', 'false');
    }
  });
}

// core game tick: update each rope independently
function tick(ts) {
  if (!lastTick) lastTick = ts;
  const dt = Math.min(48, ts - lastTick);
  lastTick = ts;
  if (!running) return;

  for (let i = 0; i < positions.length; i++) {
    const net = (rightPowers[i] - leftPowers[i]);
    const move = net * (dt / 1000) * 0.45;
    positions[i] += move;
    // decay powers
    leftPowers[i] *= Math.exp(-dt / 200);
    rightPowers[i] *= Math.exp(-dt / 200);

    // if a rope reaches an absolute end, clamp it there instead of auto-scoring/resetting:
    // keep it at 0 or 1 and zero the securing side's ongoing power so it doesn't drift past the edge,
    // but allow the opposite side's power to pull it back before time runs out.
    if (positions[i] <= 0) {
      positions[i] = 0;
      // stop further left-side pushing beyond the boundary, but allow rightPowers to contest
      leftPowers[i] = 0;
    } else if (positions[i] >= 1) {
      positions[i] = 1;
      // stop further right-side pushing beyond the boundary, but allow leftPowers to contest
      rightPowers[i] = 0;
    }
  }

  renderFlag();
  updateBlockedStates();
  timeLeft -= dt / 1000;
  if (timeLeft <= 0) {
    // stop movement and disable all pull buttons
    running = false;
    cancelAnimationFrame(raf);
    raf = null;
    setButtonsEnabled(false);

    // time up: decide winner by count of ropes >0.5 (keep final flag positions as-is)
    let leftCount = 0, rightCount = 0;
    positions.forEach(p => { if (p < 0.5) leftCount++; else if (p > 0.5) rightCount++; });
    if (leftCount > rightCount) { leftScore++; showToast('라운드 종료: 왼쪽 승리'); }
    else if (rightCount > leftCount) { rightScore++; showToast('라운드 종료: 오른쪽 승리'); }
    else showToast('라운드 종료: 무승부');

    // keep flags where they are (do not reset). clear transient powers so things don't drift.
    leftPowers = leftPowers.map(() => 0);
    rightPowers = rightPowers.map(() => 0);
    renderFlag();
    updateBlockedStates();

    // set timer to zero visually
    timeLeft = 0;
    timerEl.textContent = formatTime(0);
    timerEl.style.setProperty('--timer-pct', 0);
    timerEl.classList.add('low');

    // show end-of-game modal with summary
    const endModal = document.getElementById('end-modal');
    const endDetail = document.getElementById('end-modal-detail');
    if (endDetail) {
      endDetail.textContent = `왼쪽 ${leftCount} : 오른쪽 ${rightCount} — 결과를 확인하세요.`;
    }
    if (endModal) {
      endModal.setAttribute('aria-hidden', 'false');
    }
    return;
  }

  // update numeric and circular timer (percent)
  const pct = Math.max(0, Math.min(100, (timeLeft / roundTime) * 100));
  timerEl.textContent = formatTime(Math.ceil(timeLeft));
  timerEl.style.setProperty('--timer-pct', pct);
  // Visual low-time indicator when <=20%
  timerEl.classList.toggle('low', pct <= 20);
  raf = requestAnimationFrame(tick);
}

/* enable/disable all pull buttons (main and per-rope) */
function setButtonsEnabled(enabled) {
  // main big buttons
  const mains = [leftBtn, rightBtn].filter(Boolean);
  mains.forEach(b => { b.disabled = !enabled; b.classList.toggle('disabled', !enabled); });
  // per-rope small buttons (now lever containers)
  document.querySelectorAll('.rope-pull').forEach(b => {
    // For div role=button, we simulate disabled by class and aria
    if (!enabled) {
      b.classList.add('disabled');
      b.setAttribute('aria-disabled', 'true');
      b.style.pointerEvents = 'none'; // prevent clicks
      b.style.opacity = '0.6';
    } else {
      b.classList.remove('disabled');
      b.setAttribute('aria-disabled', 'false');
      b.style.pointerEvents = '';
      b.style.opacity = '';
    }
  });
  // start button can still be used to reset; keep it enabled
  if (startBtn) startBtn.disabled = false;
}

/* start a round: reset states, enable pulls and run timer */
function startRound() {
  if (running) return;
  roundTime = Number(durationSelect.value) || 30;
  timeLeft = roundTime;
  // update circular timer css variable (100% at start)
  timerEl.style.setProperty('--timer-pct', 100);
  timerEl.textContent = formatTime(Math.ceil(timeLeft));
  timerEl.classList.remove('low');
  lastTick = 0;
  running = true;
  // reset all ropes to middle and clear powers
  positions = positions.map(() => 0.5);
  leftPowers = leftPowers.map(() => 0);
  rightPowers = rightPowers.map(() => 0);
  renderFlag();
  showToast('라운드 시작!');
  // enable pull buttons for this round
  setButtonsEnabled(true);
  raf = requestAnimationFrame(tick);
}

// input interactions
// applyPull can target a specific rope index; if idx === null -> apply to all ropes
// Enforce max 3 secured values per side: if a side already 'owns' 3 ropes (by position),
// prevent pulling other ropes toward that side.
// Ownership thresholds: left < 0.3, right > 0.7 (rope considered secured beyond these).
function applyPull(side, force = 1, idx = null) {
  // helper to count current secured ropes for a side
  const securedCount = (s) => {
    // only full-edge positions count as secured now
    if (s === 'left') return positions.filter(p => p === 0).length;
    return positions.filter(p => p === 1).length;
  };
  // helper to determine if a given rope is already secured for the side (edge-only)
  const isSecured = (i, s) => {
    if (s === 'left') return positions[i] === 0;
    return positions[i] === 1;
  };

  // if targeting a specific rope index
  if (idx !== null) {
    // if this rope is already secured to the opposite side, allow pull (to contest),
    // but if it's not secured toward this side and this side already has 3 secured ropes, block.
    if (!isSecured(idx, side) && securedCount(side) >= 3) {
      // no-op: cannot pull this rope toward side since side already has 3 secured
      return;
    }
    if (side === 'left') leftPowers[idx] += force;
    else rightPowers[idx] += force;
    return;
  }

  // global pull: attempt to apply to each rope, but skip ropes that would violate the 3-per-side rule.
  // For global pulls, compute current counts and apply only to eligible ropes;
  // ensure we don't exceed 3 secured during the instantaneous application by skipping ropes
  // that are not already tilted toward the side when the side already has 3.
  const currentSecured = securedCount(side);
  for (let i = 0; i < positions.length; i++) {
    // if already secured to this side, always allow top-up pulls (helps keep it secured)
    if (isSecured(i, side)) {
      if (side === 'left') leftPowers[i] += force;
      else rightPowers[i] += force;
      continue;
    }
    // if side already has 3 secured, skip pulling ropes that are neutral or on the other side
    if (currentSecured >= 3) {
      continue;
    }
    // otherwise apply pull to this rope
    if (side === 'left') leftPowers[i] += force;
    else rightPowers[i] += force;
  }
}

// big page buttons (left/right main controls)
function wireMainButtons() {
  if (!leftBtn || !rightBtn) return;
  const mapBtnToSide = new Map([[leftBtn, 'left'], [rightBtn, 'right']]);
  for (const [btn, side] of mapBtnToSide.entries()) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      applyPull(side, 1.6, null);
      if (!running) startRound();
    });
    let holdInterval = null;
    const startHold = (e) => {
      e.preventDefault();
      if (!running) startRound();
      applyPull(side, 0.9, null);
      if (holdInterval) clearInterval(holdInterval);
      holdInterval = setInterval(() => applyPull(side, 0.45, null), 120);
      btn.classList.add('active');
    };
    const endHold = () => {
      if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
      btn.classList.remove('active');
    };
    btn.addEventListener('touchstart', startHold, { passive: false });
    btn.addEventListener('touchend', endHold);
    btn.addEventListener('touchcancel', endHold);
    btn.addEventListener('mousedown', startHold);
    window.addEventListener('mouseup', endHold);
  }
}

// per-rope end buttons
function wireSmallButtons(buttons, side) {
  // buttons correspond to DOM order of ropes; find their rope index by parent
  buttons.forEach(btn => {
    // find the index of this button's rope by locating the nearest .rope-wrapper
    const wrapper = btn.closest('.rope-wrapper');
    const allWrappers = Array.from(document.querySelectorAll('.rope-wrapper'));
    const idx = allWrappers.indexOf(wrapper);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      applyPull(side, 1.1, idx);
      if (!running) startRound();
    });
    let holdInterval = null;
    const startHold = (e) => {
      e.preventDefault();
      if (!running) startRound();
      applyPull(side, 0.7, idx);
      if (holdInterval) clearInterval(holdInterval);
      holdInterval = setInterval(() => applyPull(side, 0.35, idx), 140);
      btn.classList.add('active');
    };
    const endHold = () => {
      if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
      btn.classList.remove('active');
    };
    btn.addEventListener('touchstart', startHold, { passive: false });
    btn.addEventListener('touchend', endHold);
    btn.addEventListener('touchcancel', endHold);
    btn.addEventListener('mousedown', startHold);
    window.addEventListener('mouseup', endHold);
  });
}

// keyboard support
const keyState = {};
window.addEventListener('keydown', (e) => {
  if (keyState[e.code]) return;
  keyState[e.code] = true;
  if (e.code === 'KeyA') { applyPull('left', 1.2, null); if (!running) startRound(); }
  else if (e.code === 'KeyL') { applyPull('right', 1.2, null); if (!running) startRound(); }
  else if (e.code === 'Space') { startRound(); }
});
window.addEventListener('keyup', (e) => { keyState[e.code] = false; });

// start/reset main button
startBtn.addEventListener('click', () => {
  if (running) {
    running = false;
    cancelAnimationFrame(raf);
    raf = null;
    leftScore = rightScore = 0;
    positions = positions.map(() => 0.5);
    leftPowers = leftPowers.map(() => 0);
    rightPowers = rightPowers.map(() => 0);
    renderFlag();
    showToast('게임 리셋');
  } else {
    startRound();
  }
});

// end-modal close wiring
const endModalClose = qs('#end-modal-close');
const endModal = qs('#end-modal');
if (endModalClose && endModal) {
  endModalClose.addEventListener('click', () => {
    endModal.setAttribute('aria-hidden', 'true');
  });
  // allow clicking backdrop to close
  endModal.addEventListener('click', (e) => {
    if (e.target === endModal) endModal.setAttribute('aria-hidden', 'true');
  });
}

// wire setup -> game transition
toGameBtn.addEventListener('click', () => {
  const values = inputs.map(i => i.value.trim());
  // build game DOM and show
  buildRopes(values);
  pageSetup.classList.add('hidden');
  pageGame.classList.remove('hidden');
  // wire main big buttons after DOM built
  wireMainButtons();
  // initial scores/timer

  timerEl.textContent = formatTime(Number(durationSelect.value));
});

// form validation
inputs.forEach(i => {
  i.addEventListener('input', validateInputs);
});
validateInputs();

// resize handling
window.addEventListener('resize', () => updateWidth());

// idle jitter for flags when not running (after ropes built)
setInterval(() => {
  if (running || flagEls.length === 0) return;
  // jitter each rope slightly independently
  for (let i = 0; i < positions.length; i++) {
    const jitter = (Math.random() - 0.5) * 0.012;
    positions[i] = Math.max(0, Math.min(1, positions[i] + jitter));
  }
  renderFlag();
  updateBlockedStates();
}, 800);