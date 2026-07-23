import { FEATURED_PUZZLE } from "./featured-puzzle.js";
import { decodePayload } from "./puzzle.js";

function key(row, col) {
  return `${row},${col}`;
}

const els = {
  title: document.getElementById("solver-title"),
  author: document.getElementById("solver-author"),
  panel: document.getElementById("solver-panel"),
  boardWrap: document.querySelector("#solver-panel .board-wrap"),
  grid: document.getElementById("solver-grid"),
  across: document.getElementById("across-clues"),
  down: document.getElementById("down-clues"),
  checkBtn: document.getElementById("check-btn"),
  revealBtn: document.getElementById("reveal-btn"),
  resetBtn: document.getElementById("reset-btn"),
  printBtn: document.getElementById("print-btn"),
  timer: document.getElementById("solve-timer"),
  pauseBtn: document.getElementById("pause-btn"),
  pauseOverlay: document.getElementById("pause-overlay"),
  resumeBtn: document.getElementById("resume-btn"),
  completionDialog: document.getElementById("completion-dialog"),
  completionTitle: document.getElementById("completion-title"),
  completionMessage: document.getElementById("completion-message"),
  completionTime: document.getElementById("completion-time"),
  completionCloseBtn: document.getElementById("completion-close-btn"),
  zoomOutBtn: document.getElementById("zoom-out-btn"),
  zoomFitBtn: document.getElementById("zoom-fit-btn"),
  zoomInBtn: document.getElementById("zoom-in-btn"),
  zoomLevel: document.getElementById("zoom-level"),
  loadLinkInput: document.getElementById("load-link-input"),
  loadLinkBtn: document.getElementById("load-link-btn"),
  loadLinkMessage: document.getElementById("load-link-message"),
};

const BASE_CELL_SIZE = 32;
const CELL_GAP = 2;
const MIN_CELL_SIZE = 14;
const MAX_CELL_SIZE = 64;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 0.15;

const state = {
  puzzle: null,
  fill: [],
  activeDirection: "across",
  activeCell: null,
  nav: null,
  inputsByCoord: new Map(),
  cellsByCoord: new Map(),
  clueItems: {
    across: new Map(),
    down: new Map(),
  },
  pendingMouseCell: null,
  fitCellSize: BASE_CELL_SIZE,
  zoom: 1,
  timerStart: 0,
  timerElapsedMs: 0,
  timerIntervalId: null,
  paused: false,
  revealUsed: false,
  completed: false,
};

// --- Solve timer -----------------------------------------------------------

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (n) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

function currentElapsedMs() {
  const running = state.timerIntervalId !== null ? Date.now() - state.timerStart : 0;
  return state.timerElapsedMs + running;
}

function renderTimer() {
  els.timer.textContent = formatTime(currentElapsedMs());
}

function stopTimerInterval() {
  if (state.timerIntervalId !== null) {
    clearInterval(state.timerIntervalId);
    state.timerElapsedMs += Date.now() - state.timerStart;
    state.timerIntervalId = null;
  }
}

function startTimerInterval() {
  if (state.timerIntervalId !== null || state.completed) {
    return;
  }
  state.timerStart = Date.now();
  state.timerIntervalId = setInterval(renderTimer, 500);
  renderTimer();
}

function resetTimer() {
  stopTimerInterval();
  state.timerElapsedMs = 0;
  renderTimer();
  startTimerInterval();
}

function setPaused(paused) {
  if (!state.puzzle || state.paused === paused) {
    return;
  }

  state.paused = paused;
  els.pauseOverlay.classList.toggle("hidden", !paused);
  els.grid.classList.toggle("grid-paused", paused);
  els.pauseBtn.textContent = paused ? "Resume" : "Pause";

  if (paused) {
    stopTimerInterval();
    if (document.activeElement && els.grid.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    els.resumeBtn.focus();
  } else {
    startTimerInterval();
    if (state.activeCell) {
      focusCell(state.activeCell.row, state.activeCell.col);
    }
  }
}

// --- Completion ------------------------------------------------------------

function isPuzzleSolved() {
  for (let row = 0; row < state.puzzle.rows; row += 1) {
    for (let col = 0; col < state.puzzle.cols; col += 1) {
      const cell = state.puzzle.grid[row][col];
      if (!cell.block && state.fill[row][col] !== cell.solution) {
        return false;
      }
    }
  }
  return true;
}

function showCompletion() {
  stopTimerInterval();
  state.completed = true;
  els.pauseBtn.disabled = true;
  renderTimer();

  if (state.revealUsed) {
    els.completionTitle.textContent = "Puzzle Complete";
    els.completionMessage.textContent =
      "You got there with a little help from Reveal. Every finished grid still counts!";
  } else {
    els.completionTitle.textContent = "Congratulations!";
    els.completionMessage.textContent = "You solved the whole puzzle on your own. Nicely done!";
  }

  els.completionTime.textContent = formatTime(state.timerElapsedMs);
  if (typeof els.completionDialog.showModal === "function") {
    els.completionDialog.showModal();
  }
}

function maybeComplete() {
  if (state.completed || !state.puzzle || !isPuzzleSolved()) {
    return;
  }
  showCompletion();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateZoomControls() {
  const hasPuzzle = Boolean(state.puzzle);
  els.zoomOutBtn.disabled = !hasPuzzle || state.zoom <= MIN_ZOOM;
  els.zoomFitBtn.disabled = !hasPuzzle;
  els.zoomInBtn.disabled = !hasPuzzle || state.zoom >= MAX_ZOOM;

  if (!hasPuzzle) {
    els.zoomLevel.textContent = "100%";
    return;
  }

  els.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function computeFitCellSize() {
  if (!state.puzzle || !els.boardWrap) {
    return BASE_CELL_SIZE;
  }

  const wrapStyle = getComputedStyle(els.boardWrap);
  const horizontalPadding = parseFloat(wrapStyle.paddingLeft) + parseFloat(wrapStyle.paddingRight);
  const verticalPadding = parseFloat(wrapStyle.paddingTop) + parseFloat(wrapStyle.paddingBottom);
  const availableWidth = Math.max(0, els.boardWrap.clientWidth - horizontalPadding);
  const bounds = els.boardWrap.getBoundingClientRect();
  const visibleHeight = Math.max(0, window.innerHeight - bounds.top - 32 - verticalPadding);
  const availableHeight = Math.max(480, visibleHeight);

  const widthCell = (availableWidth - CELL_GAP * (state.puzzle.cols - 1)) / state.puzzle.cols;
  const heightCell = (availableHeight - CELL_GAP * (state.puzzle.rows - 1)) / state.puzzle.rows;
  return clamp(Math.floor(Math.min(BASE_CELL_SIZE, widthCell, heightCell)), MIN_CELL_SIZE, BASE_CELL_SIZE);
}

function applyGridZoom() {
  if (!state.puzzle) {
    updateZoomControls();
    return;
  }

  state.fitCellSize = computeFitCellSize();
  const cellSize = clamp(Math.round(state.fitCellSize * state.zoom), MIN_CELL_SIZE, MAX_CELL_SIZE);
  els.grid.style.setProperty("--solver-cell-size", `${cellSize}px`);
  updateZoomControls();
}

function setZoom(nextZoom) {
  state.zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  applyGridZoom();
}

function buildNavigationData(puzzle) {
  const numberByStart = new Map();
  const acrossStarts = [];
  const downStarts = [];
  const startsByNumber = new Map();
  const clueStarts = puzzle.clueStarts;

  if (clueStarts?.across?.length || clueStarts?.down?.length) {
    clueStarts.across.forEach((start) => {
      numberByStart.set(key(start.row, start.col), start.number);
      startsByNumber.set(start.number, { row: start.row, col: start.col, across: true, down: false });
      acrossStarts.push({ number: start.number, row: start.row, col: start.col });
    });

    clueStarts.down.forEach((start) => {
      const existing = startsByNumber.get(start.number) || {
        row: start.row,
        col: start.col,
        across: false,
        down: false,
      };
      numberByStart.set(key(start.row, start.col), start.number);
      startsByNumber.set(start.number, { ...existing, down: true });
      downStarts.push({ number: start.number, row: start.row, col: start.col });
    });

    acrossStarts.sort((a, b) => a.number - b.number);
    downStarts.sort((a, b) => a.number - b.number);
    return { numberByStart, startsByNumber, acrossStarts, downStarts };
  }

  let n = 1;
  for (let row = 0; row < puzzle.rows; row += 1) {
    for (let col = 0; col < puzzle.cols; col += 1) {
      if (puzzle.grid[row][col].block) {
        continue;
      }

      const startsAcross = col === 0 || puzzle.grid[row][col - 1].block;
      const startsDown = row === 0 || puzzle.grid[row - 1][col].block;
      if (startsAcross || startsDown) {
        numberByStart.set(key(row, col), n);
        startsByNumber.set(n, { row, col, across: startsAcross, down: startsDown });
        if (startsAcross) {
          acrossStarts.push({ number: n, row, col });
        }
        if (startsDown) {
          downStarts.push({ number: n, row, col });
        }
        n += 1;
      }
    }
  }

  return { numberByStart, startsByNumber, acrossStarts, downStarts };
}

function isOpenCell(row, col) {
  return (
    row >= 0 &&
    col >= 0 &&
    row < state.puzzle.rows &&
    col < state.puzzle.cols &&
    !state.puzzle.grid[row][col].block
  );
}

function stepInDirection(row, col, direction, amount = 1) {
  if (direction === "down") {
    return { row: row + amount, col };
  }

  return { row, col: col + amount };
}

function findWordStart(row, col, direction) {
  let currentRow = row;
  let currentCol = col;

  while (true) {
    const prev = stepInDirection(currentRow, currentCol, direction, -1);
    if (!isOpenCell(prev.row, prev.col)) {
      return { row: currentRow, col: currentCol };
    }
    currentRow = prev.row;
    currentCol = prev.col;
  }
}

function findWordEnd(row, col, direction) {
  let currentRow = row;
  let currentCol = col;

  while (true) {
    const next = stepInDirection(currentRow, currentCol, direction, 1);
    if (!isOpenCell(next.row, next.col)) {
      return { row: currentRow, col: currentCol };
    }
    currentRow = next.row;
    currentCol = next.col;
  }
}

function findClueNumberAt(row, col, direction) {
  const start = findWordStart(row, col, direction);
  const info = state.nav.numberByStart.get(key(start.row, start.col));
  return info || null;
}

function scrollClueWithinList(clueItem) {
  const container = clueItem.parentElement;
  if (!container) {
    return;
  }

  const itemTop = clueItem.offsetTop;
  const itemBottom = itemTop + clueItem.offsetHeight;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;

  if (itemTop < viewTop) {
    container.scrollTop = itemTop;
    return;
  }

  if (itemBottom > viewBottom) {
    container.scrollTop = itemBottom - container.clientHeight;
  }
}

function captureWindowScroll() {
  const scrollLeft = window.scrollX;
  const scrollTop = window.scrollY;
  return () => {
    window.scrollTo(scrollLeft, scrollTop);
  };
}

function updateActiveHighlights() {
  state.cellsByCoord.forEach((cellEl) => {
    cellEl.classList.remove("active-word", "active-cell");
  });

  state.clueItems.across.forEach((item) => item.classList.remove("active-clue"));
  state.clueItems.down.forEach((item) => item.classList.remove("active-clue"));

  if (!state.activeCell) {
    return;
  }

  const { row, col } = state.activeCell;
  if (!isOpenCell(row, col)) {
    return;
  }

  const start = findWordStart(row, col, state.activeDirection);
  const end = findWordEnd(row, col, state.activeDirection);

  let currentRow = start.row;
  let currentCol = start.col;
  while (true) {
    const cellEl = state.cellsByCoord.get(key(currentRow, currentCol));
    if (cellEl) {
      cellEl.classList.add("active-word");
    }

    if (currentRow === end.row && currentCol === end.col) {
      break;
    }

    const next = stepInDirection(currentRow, currentCol, state.activeDirection, 1);
    currentRow = next.row;
    currentCol = next.col;
  }

  const activeCellEl = state.cellsByCoord.get(key(row, col));
  if (activeCellEl) {
    activeCellEl.classList.add("active-cell");
  }

  const clueNumber = findClueNumberAt(row, col, state.activeDirection);
  if (clueNumber !== null) {
    const clueItem = state.clueItems[state.activeDirection].get(clueNumber);
    if (clueItem) {
      clueItem.classList.add("active-clue");
      scrollClueWithinList(clueItem);
    }
  }
}

function clueStartsForDirection(direction) {
  return direction === "down" ? state.nav.downStarts : state.nav.acrossStarts;
}

function focusClue(number, direction) {
  const start = state.nav.startsByNumber.get(number);
  if (!start) {
    return;
  }

  const restoreWindowScroll = captureWindowScroll();
  state.activeDirection = direction;
  focusCell(start.row, start.col);
  requestAnimationFrame(restoreWindowScroll);
}

function findCurrentClueIndex(row, col, direction) {
  const currentNumber = findClueNumberAt(row, col, direction);
  if (currentNumber === null) {
    return -1;
  }

  return clueStartsForDirection(direction).findIndex((entry) => entry.number === currentNumber);
}

function focusCell(row, col) {
  const input = state.inputsByCoord.get(key(row, col));
  if (!input) {
    return;
  }

  const restoreWindowScroll = captureWindowScroll();
  input.focus();
  requestAnimationFrame(restoreWindowScroll);
  const caret = input.value.length;
  input.setSelectionRange(caret, caret);
  state.activeCell = { row, col };
  updateActiveHighlights();
}

function goToNextWordStart(row, col, direction) {
  const index = findCurrentClueIndex(row, col, direction);
  if (index < 0) {
    return;
  }

  const starts = clueStartsForDirection(direction);
  if (index < 0) {
    return;
  }

  if (index >= starts.length - 1) {
    const oppositeDirection = direction === "across" ? "down" : "across";
    const oppositeStarts = clueStartsForDirection(oppositeDirection);
    if (!oppositeStarts.length) {
      return;
    }

    const firstOpposite = oppositeStarts[0];
    state.activeDirection = oppositeDirection;
    focusCell(firstOpposite.row, firstOpposite.col);
    return;
  }

  const next = starts[index + 1];
  focusCell(next.row, next.col);
}

function moveForwardFrom(row, col, direction) {
  const wordEnd = findWordEnd(row, col, direction);
  if (row === wordEnd.row && col === wordEnd.col) {
    goToNextWordStart(row, col, direction);
    return;
  }

  const next = stepInDirection(row, col, direction, 1);
  if (isOpenCell(next.row, next.col)) {
    focusCell(next.row, next.col);
    return;
  }

  goToNextWordStart(row, col, direction);
}

function moveBackwardFrom(row, col, direction) {
  const prev = stepInDirection(row, col, direction, -1);
  if (isOpenCell(prev.row, prev.col)) {
    focusCell(prev.row, prev.col);
  }
}

function clearCell(row, col) {
  const targetInput = state.inputsByCoord.get(key(row, col));
  if (!targetInput) {
    return;
  }

  targetInput.value = "";
  state.fill[row][col] = "";
  targetInput.classList.remove("good", "bad");
}

function isAtWordStart(row, col, direction) {
  const start = findWordStart(row, col, direction);
  return start.row === row && start.col === col;
}

function hasWordAt(row, col, direction) {
  const number = findClueNumberAt(row, col, direction);
  if (number === null) {
    return false;
  }

  const start = state.nav.startsByNumber.get(number);
  return Boolean(start && start[direction]);
}

function toggleDirectionAt(row, col) {
  const nextDirection = state.activeDirection === "across" ? "down" : "across";
  if (!hasWordAt(row, col, nextDirection)) {
    return;
  }

  state.activeDirection = nextDirection;
  updateActiveHighlights();
}

function handleCellFocus(row, col) {
  state.activeCell = { row, col };
  updateActiveHighlights();
}

function drawClues() {
  const write = (target, clues, direction) => {
    target.innerHTML = "";
    state.clueItems[direction] = new Map();
    clueStartsForDirection(direction).forEach((start) => {
      const number = start.number;
      const li = document.createElement("li");
      li.dataset.number = String(number);
      li.setAttribute("role", "button");
      li.tabIndex = 0;
      li.textContent = `${number}. ${clues[number] || "(clue not set)"}`;
      li.addEventListener("click", () => {
        focusClue(number, direction);
      });
      li.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          focusClue(number, direction);
        }
      });
      target.appendChild(li);
      state.clueItems[direction].set(number, li);
    });
  };

  write(els.across, state.puzzle.clues.across, "across");
  write(els.down, state.puzzle.clues.down, "down");
}

function drawGrid() {
  const puzzle = state.puzzle;
  const map = state.nav.numberByStart;

  els.grid.innerHTML = "";
  els.grid.style.gridTemplateColumns = `repeat(${puzzle.cols}, var(--cell-size))`;
  els.grid.style.setProperty("--grid-cols", String(puzzle.cols));
  els.grid.style.setProperty("--grid-rows", String(puzzle.rows));
  state.inputsByCoord = new Map();
  state.cellsByCoord = new Map();

  for (let row = 0; row < puzzle.rows; row += 1) {
    for (let col = 0; col < puzzle.cols; col += 1) {
      const cell = puzzle.grid[row][col];
      const cellEl = document.createElement("div");
      cellEl.className = "cell";
      if (cell.block) {
        cellEl.classList.add("black");
      } else {
        state.cellsByCoord.set(key(row, col), cellEl);
        const number = map.get(key(row, col));
        if (number) {
          const numberEl = document.createElement("span");
          numberEl.className = "cell-num";
          numberEl.textContent = String(number);
          cellEl.appendChild(numberEl);
        }

        const input = document.createElement("input");
        input.maxLength = 1;
        input.setAttribute("data-row", String(row));
        input.setAttribute("data-col", String(col));
        state.inputsByCoord.set(key(row, col), input);

        input.addEventListener("mousedown", () => {
          state.pendingMouseCell = {
            row,
            col,
            wasFocused: document.activeElement === input,
          };
        });

        input.addEventListener("focus", () => {
          handleCellFocus(row, col);
          const caret = input.value.length;
          input.setSelectionRange(caret, caret);
        });

        input.addEventListener("click", () => {
          const pending = state.pendingMouseCell;
          state.pendingMouseCell = null;
          if (pending && pending.row === row && pending.col === col && pending.wasFocused) {
            toggleDirectionAt(row, col);
          }
          const caret = input.value.length;
          input.setSelectionRange(caret, caret);
        });

        input.addEventListener("keydown", (evt) => {
          if (evt.key === "ArrowRight") {
            evt.preventDefault();
            state.activeDirection = "across";
            updateActiveHighlights();
            moveForwardFrom(row, col, "across");
            return;
          }

          if (evt.key === "ArrowLeft") {
            evt.preventDefault();
            state.activeDirection = "across";
            updateActiveHighlights();
            moveBackwardFrom(row, col, "across");
            return;
          }

          if (evt.key === "ArrowDown") {
            evt.preventDefault();
            state.activeDirection = "down";
            updateActiveHighlights();
            moveForwardFrom(row, col, "down");
            return;
          }

          if (evt.key === "ArrowUp") {
            evt.preventDefault();
            state.activeDirection = "down";
            updateActiveHighlights();
            moveBackwardFrom(row, col, "down");
            return;
          }

          if (evt.key === "Backspace") {
            evt.preventDefault();
            if (input.value) {
              clearCell(row, col);
              if (isAtWordStart(row, col, state.activeDirection)) {
                return;
              }
              moveBackwardFrom(row, col, state.activeDirection);
              return;
            }

            if (isAtWordStart(row, col, state.activeDirection)) {
              return;
            }

            const prev = stepInDirection(row, col, state.activeDirection, -1);
            if (!isOpenCell(prev.row, prev.col)) {
              return;
            }

            clearCell(prev.row, prev.col);
            focusCell(prev.row, prev.col);
          }
        });

        input.addEventListener("input", (evt) => {
          const letter = (evt.target.value || "").toUpperCase().replace(/[^A-Z]/g, "").slice(-1);
          evt.target.value = letter;
          state.fill[row][col] = letter;
          evt.target.classList.remove("good", "bad");

          if (!letter) {
            return;
          }

          maybeComplete();
          moveForwardFrom(row, col, state.activeDirection);
        });

        cellEl.appendChild(input);
      }

      els.grid.appendChild(cellEl);
    }
  }

  applyGridZoom();
}

function setPuzzle(puzzle) {
  state.puzzle = puzzle;
  state.fill = puzzle.grid.map((row) => row.map((cell) => (cell.block ? "#" : "")));
  state.nav = buildNavigationData(puzzle);
  state.activeDirection = "across";
  state.activeCell = null;
  state.zoom = 1;
  state.revealUsed = false;
  state.completed = false;
  state.paused = false;
  els.pauseOverlay.classList.add("hidden");
  els.grid.classList.remove("grid-paused");
  els.pauseBtn.textContent = "Pause";

  els.title.textContent = puzzle.title || "Untitled Puzzle";
  els.author.textContent = `by ${puzzle.author || "unknown"}`;
  els.panel.classList.remove("hidden");
  els.checkBtn.disabled = false;
  els.revealBtn.disabled = false;
  els.resetBtn.disabled = false;
  els.printBtn.disabled = false;
  els.pauseBtn.disabled = false;

  resetTimer();

  drawGrid();
  drawClues();

  const first = state.nav.acrossStarts[0] || state.nav.downStarts[0];
  if (first) {
    focusCell(first.row, first.col);
  }
}

function checkPuzzle() {
  let solved = true;
  const inputs = els.grid.querySelectorAll("input");
  inputs.forEach((input) => {
    const row = Number(input.dataset.row);
    const col = Number(input.dataset.col);
    const answer = state.puzzle.grid[row][col].solution;
    const guess = (input.value || "").toUpperCase();
    if (guess === answer) {
      input.classList.add("good");
      input.classList.remove("bad");
    } else {
      input.classList.add("bad");
      input.classList.remove("good");
      solved = false;
    }
  });

  if (solved) {
    maybeComplete();
  }
}

function revealPuzzle() {
  state.revealUsed = true;
  const inputs = els.grid.querySelectorAll("input");
  inputs.forEach((input) => {
    const row = Number(input.dataset.row);
    const col = Number(input.dataset.col);
    const answer = state.puzzle.grid[row][col].solution;
    input.value = answer;
    input.classList.remove("bad");
    input.classList.add("good");
    state.fill[row][col] = answer;
  });

  maybeComplete();
}

function clearFill() {
  state.fill = state.puzzle.grid.map((row) => row.map((cell) => (cell.block ? "#" : "")));
  state.revealUsed = false;
  state.completed = false;
  els.pauseBtn.disabled = false;
  setPaused(false);
  drawGrid();
  resetTimer();
}

function extractPParam(fragment) {
  // Deliberately not using URLSearchParams here: it implements
  // application/x-www-form-urlencoded parsing, which treats "+" as a space.
  // Encoded payloads can legitimately contain "+" (legacy links) or just be
  // plain base64url text, so a literal split avoids silently corrupting them.
  const match = /(?:^|&)p=([^&]*)/.exec(fragment);
  return match ? match[1] : null;
}

function hasFeaturedParam(fragment) {
  return /(?:^|&)featured=1(?:&|$)/.test(fragment);
}

function maybePuzzleFromHash() {
  const fragment = window.location.hash.slice(1);
  const encoded = extractPParam(fragment);
  if (!encoded) {
    return hasFeaturedParam(fragment) ? FEATURED_PUZZLE : null;
  }

  try {
    return decodePayload(encoded);
  } catch {
    return null;
  }
}

function setLoadLinkMessage(text, isError) {
  els.loadLinkMessage.textContent = text;
  els.loadLinkMessage.classList.toggle("bad", Boolean(isError));
  els.loadLinkMessage.classList.toggle("good", !isError);
}

// Accepts whatever someone might paste in: a full share URL, just the
// "#p=..." fragment, a bare "p=..." query string, or the raw encoded payload
// itself — so people don't have to hand-edit the browser address bar to open
// a puzzle someone sent them.
function extractEncodedPayload(raw) {
  const text = (raw || "").trim();
  if (!text) {
    return null;
  }

  let fragment = text;
  try {
    fragment = new URL(text).hash || fragment;
  } catch {
    // Not a full URL — fall through and treat it as a fragment/raw payload.
  }

  fragment = fragment.replace(/^#/, "");
  const fromParams = extractPParam(fragment);
  if (fromParams) {
    return fromParams;
  }

  return fragment.includes("=") ? null : fragment;
}

function loadPuzzleFromLinkInput() {
  const encoded = extractEncodedPayload(els.loadLinkInput.value);
  if (!encoded) {
    setLoadLinkMessage("Paste a valid solver link.", true);
    return;
  }

  let puzzle;
  try {
    puzzle = decodePayload(encoded);
  } catch {
    setLoadLinkMessage("Couldn't read that link. Double-check it was copied in full.", true);
    return;
  }

  setPuzzle(puzzle);
  window.history.replaceState(null, "", `#p=${encoded}`);
  setLoadLinkMessage("Puzzle loaded.");
}

els.checkBtn.addEventListener("click", checkPuzzle);
els.revealBtn.addEventListener("click", revealPuzzle);
els.resetBtn.addEventListener("click", clearFill);
els.printBtn.addEventListener("click", () => window.print());
els.pauseBtn.addEventListener("click", () => setPaused(!state.paused));
els.resumeBtn.addEventListener("click", () => setPaused(false));
els.completionCloseBtn.addEventListener("click", () => els.completionDialog.close());
els.zoomOutBtn.addEventListener("click", () => setZoom(state.zoom - ZOOM_STEP));
els.zoomFitBtn.addEventListener("click", () => setZoom(1));
els.zoomInBtn.addEventListener("click", () => setZoom(state.zoom + ZOOM_STEP));
els.loadLinkBtn.addEventListener("click", loadPuzzleFromLinkInput);
els.loadLinkInput.addEventListener("keydown", (evt) => {
  if (evt.key === "Enter") {
    evt.preventDefault();
    loadPuzzleFromLinkInput();
  }
});

window.addEventListener("resize", applyGridZoom);

if (typeof ResizeObserver === "function" && els.boardWrap) {
  const boardResizeObserver = new ResizeObserver(() => {
    applyGridZoom();
  });
  boardResizeObserver.observe(els.boardWrap);
}

updateZoomControls();

const incoming = maybePuzzleFromHash();
if (incoming) {
  setPuzzle(incoming);
}
