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
};

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

function handleCellFocus(row, col) {
  const clickedSameCell =
    state.pendingMouseCell && state.pendingMouseCell.row === row && state.pendingMouseCell.col === col;
  const wasSameActive = state.activeCell && state.activeCell.row === row && state.activeCell.col === col;

  if (clickedSameCell && wasSameActive) {
    state.activeDirection = state.activeDirection === "across" ? "down" : "across";
  }

  state.activeCell = { row, col };
  state.pendingMouseCell = null;
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
          state.pendingMouseCell = { row, col };
        });

        input.addEventListener("focus", () => {
          handleCellFocus(row, col);
          const caret = input.value.length;
          input.setSelectionRange(caret, caret);
        });

        input.addEventListener("click", () => {
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

  els.title.textContent = puzzle.title || "Untitled Puzzle";
  els.author.textContent = `by ${puzzle.author || "unknown"}`;
  els.panel.classList.remove("hidden");
  els.checkBtn.disabled = false;
  els.revealBtn.disabled = false;
  els.resetBtn.disabled = false;

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
    alert("Puzzle solved.");
  }
}

function revealPuzzle() {
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
}

function clearFill() {
  state.fill = state.puzzle.grid.map((row) => row.map((cell) => (cell.block ? "#" : "")));
  drawGrid();
}

function extractPParam(fragment) {
  // Deliberately not using URLSearchParams here: it implements
  // application/x-www-form-urlencoded parsing, which treats "+" as a space.
  // Encoded payloads can legitimately contain "+" (legacy links) or just be
  // plain base64url text, so a literal split avoids silently corrupting them.
  const match = /(?:^|&)p=([^&]*)/.exec(fragment);
  return match ? match[1] : null;
}

function maybePuzzleFromHash() {
  const encoded = extractPParam(window.location.hash.slice(1));
  if (!encoded) {
    return null;
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
