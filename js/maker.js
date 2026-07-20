import { buildPuzzleWithReport, computeSlots, encodePayload, normalizePuzzle } from "./puzzle.js";

const STORAGE_KEY = "crossrave.latest";
const DRAFTS_STORAGE_KEY = "crossrave.drafts";

const els = {
  title: document.getElementById("puzzle-title"),
  author: document.getElementById("puzzle-author"),
  modeAutomaticBtn: document.getElementById("mode-automatic-btn"),
  modeManualBtn: document.getElementById("mode-manual-btn"),
  automaticSection: document.getElementById("automatic-section"),
  manualSection: document.getElementById("manual-section"),
  entryRows: document.getElementById("entry-rows"),
  addRowBtn: document.getElementById("add-row-btn"),
  generationMode: document.getElementById("generation-mode"),
  generateBtn: document.getElementById("generate-btn"),
  manualViewport: document.getElementById("manual-grid-viewport"),
  manualBlockToggleBtn: document.getElementById("manual-block-toggle-btn"),
  manualClearBtn: document.getElementById("manual-clear-btn"),
  manualRecenterBtn: document.getElementById("manual-recenter-btn"),
  manualBuildBtn: document.getElementById("manual-build-btn"),
  manualGrid: document.getElementById("manual-grid"),
  manualAcross: document.getElementById("manual-across-clues"),
  manualDown: document.getElementById("manual-down-clues"),
  saveNameInput: document.getElementById("save-name-input"),
  saveBtn: document.getElementById("save-local-btn"),
  downloadBtn: document.getElementById("download-btn"),
  uploadInput: document.getElementById("upload-input"),
  savedDraftsEmpty: document.getElementById("saved-drafts-empty"),
  savedDraftsList: document.getElementById("saved-drafts-list"),
  shareBtn: document.getElementById("share-btn"),
  shareUrl: document.getElementById("share-url"),
  copyLinkBtn: document.getElementById("copy-link-btn"),
  message: document.getElementById("maker-message"),
  panel: document.getElementById("generated-panel"),
  grid: document.getElementById("maker-grid"),
  across: document.getElementById("across-clues"),
  down: document.getElementById("down-clues"),
  reportBox: document.getElementById("placement-report"),
  reportSummary: document.getElementById("placement-summary"),
  unplacedList: document.getElementById("unplaced-list"),
};

const state = {
  puzzle: null,
};

function sanitizeDraftText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function normalizeDraftRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.slice(0, 250).map((entry) => ({
    answer: String(entry?.answer || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 32),
    clue: sanitizeDraftText(entry?.clue, 180),
  }));
}

function normalizeDraftPayload(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Draft payload must be an object.");
  }

  return {
    title: sanitizeDraftText(parsed.title, 120),
    author: sanitizeDraftText(parsed.author, 80),
    generationMode: parsed.generationMode === "maxIntersections" ? "maxIntersections" : "compactness",
    entryRows: normalizeDraftRows(parsed.entryRows),
    puzzle: parsed.puzzle ? normalizePuzzle(parsed.puzzle) : null,
  };
}

// The manual grid is an unbounded sheet of graph paper: cells live in a sparse
// Map keyed by absolute "row,col" coordinates (which may be negative), and the
// pannable range grows outward as the user scrolls near an edge. Only the
// cells near the current scroll position are ever materialized as DOM nodes
// (see renderManualWindow) — otherwise a long editing session could leave
// tens of thousands of live <input> elements around, which is what made the
// grid laggy and prone to losing focus.
const MANUAL_CELL_SIZE = 36;
const MANUAL_GRID_GAP = 2;
const MANUAL_CELL_PITCH = MANUAL_CELL_SIZE + MANUAL_GRID_GAP;
const MANUAL_EXPAND_STEP = 8;
const MANUAL_EXPAND_THRESHOLD = MANUAL_CELL_SIZE * 3;
const MANUAL_MAX_EXTENT = 100;
const MANUAL_RENDER_BUFFER = 6;

const manualState = {
  minRow: -8,
  maxRow: 8,
  minCol: -8,
  maxCol: 8,
  cells: new Map(),
  blockMode: false,
  clueText: new Map(),
  centered: false,
  // DOM refs kept in sync incrementally so typing/toggling never has to tear
  // down and recreate the whole grid (that was the source of lag and of
  // losing focus on Backspace, since the focused input was destroyed every
  // keystroke). Full rebuilds only happen when the rendered range itself
  // changes (expansion, clear, initial draw).
  cellEls: new Map(),
  inputEls: new Map(),
  numberEls: new Map(),
  lastNumbering: new Map(),
  // Tracks which cell is focused and which direction ("across"/"down") it's
  // being worked in, so the current row/column can be lightly highlighted
  // and so auto-advance/backspace move the right way. Clicking the same
  // cell again flips the direction; clicking a different cell resets to the
  // default ("across").
  selectedRow: null,
  selectedCol: null,
  selectedDirection: "across",
};

function manualCellKey(row, col) {
  return `${row},${col}`;
}

function getManualCell(row, col) {
  return manualState.cells.get(manualCellKey(row, col)) || { block: false, solution: "" };
}

function setManualCell(row, col, value) {
  const key = manualCellKey(row, col);
  if (!value.block && !value.solution) {
    manualState.cells.delete(key);
  } else {
    manualState.cells.set(key, value);
  }
}

function manualKey(row, col, direction) {
  return `${row},${col},${direction}`;
}

function manualNextOpenCell(row, col, dr, dc) {
  let r = row + dr;
  let c = col + dc;

  while (r >= manualState.minRow && r <= manualState.maxRow && c >= manualState.minCol && c <= manualState.maxCol) {
    if (!getManualCell(r, c).block) {
      return ensureManualCellRendered(r, c);
    }
    r += dr;
    c += dc;
  }

  return null;
}

// Numbering must be based on the bounding box of the user's actual content
// (letters/blocks), not the currently scrolled viewport range — otherwise the
// edges of the pannable canvas would be mistaken for puzzle boundaries and
// produce spurious numbers that shift as the user scrolls.
function computeManualSlots() {
  const bounds = computeManualBounds();
  if (!Number.isFinite(bounds.minRow)) {
    return { across: [], down: [] };
  }

  const rows = bounds.maxRow - bounds.minRow + 1;
  const cols = bounds.maxCol - bounds.minCol + 1;
  const grid = [];
  for (let r = 0; r < rows; r += 1) {
    const gridRow = [];
    for (let c = 0; c < cols; c += 1) {
      const cell = getManualCell(bounds.minRow + r, bounds.minCol + c);
      // A cell inside the bounding rectangle that has neither a letter nor
      // an explicit block is just empty space (an artifact of the box
      // being rectangular around an L/T-shaped set of words), not a real
      // grid cell yet. Treat it as a wall for slot detection so it can
      // never be mistaken for a word in progress — otherwise every new
      // letter typed could reveal a fresh phantom word/number through
      // untouched neighboring cells.
      gridRow.push({ block: cell.block || !cell.solution });
    }
    grid.push(gridRow);
  }

  const slots = computeSlots(grid, rows, cols);
  const toVirtual = (list) =>
    list.map((slot) => ({
      number: slot.number,
      row: bounds.minRow + slot.row,
      col: bounds.minCol + slot.col,
      length: slot.length,
    }));

  return { across: toVirtual(slots.across), down: toVirtual(slots.down) };
}

// Builds one grid cell's DOM (either a black square or a letter input) and
// wires up its listeners. Registers the element(s) into manualState's lookup
// maps so later updates can find them without touching the rest of the grid.
function createManualCellElement(row, col) {
  const keyStr = manualCellKey(row, col);
  const cell = getManualCell(row, col);
  const cellEl = document.createElement("div");
  cellEl.className = "cell";

  if (cell.block) {
    cellEl.classList.add("black");
    cellEl.addEventListener("click", () => {
      if (!manualState.blockMode) {
        return;
      }
      setManualCell(row, col, { block: false, solution: "" });
      rebuildManualCell(row, col);
      refreshManualNumbering();
      drawManualClues();
    });
  } else {
    const input = document.createElement("input");
    input.maxLength = 1;
    input.value = cell.solution;
    input.setAttribute("data-row", String(row));
    input.setAttribute("data-col", String(col));

    // Native focus happens on mousedown, before the click event fires, so by
    // the time a click handler runs manualState.selectedRow/Col would
    // already reflect *this* cell — making "was this the same cell as
    // before" impossible to detect there. Capture that on mousedown, before
    // anything changes it.
    let wasAlreadySelected = false;
    input.addEventListener("mousedown", () => {
      wasAlreadySelected = manualState.selectedRow === row && manualState.selectedCol === col;
    });

    input.addEventListener("click", () => {
      if (manualState.blockMode) {
        setManualCell(row, col, { block: true, solution: "" });
        rebuildManualCell(row, col);
        refreshManualNumbering();
        drawManualClues();
        return;
      }

      const nextDirection = wasAlreadySelected
        ? manualState.selectedDirection === "across"
          ? "down"
          : "across"
        : "across";
      setManualSelection(row, col, nextDirection);
    });

    input.addEventListener("focus", () => {
      const caret = input.value.length;
      input.setSelectionRange(caret, caret);
    });

    input.addEventListener("input", (evt) => {
      const letter = (evt.target.value || "").toUpperCase().replace(/[^A-Z]/g, "").slice(-1);
      evt.target.value = letter;
      setManualCell(row, col, { block: false, solution: letter });
      // Only the numbering/clue list need to refresh here — the grid's cells
      // and inputs stay exactly as they are, so focus is never disturbed.
      refreshManualNumbering();
      drawManualClues();

      if (letter) {
        const [dr, dc] = manualState.selectedDirection === "down" ? [1, 0] : [0, 1];
        focusManualCell(manualNextOpenCell(row, col, dr, dc));
      }
    });

    input.addEventListener("keydown", (evt) => {
      const moves = {
        ArrowRight: [0, 1],
        ArrowLeft: [0, -1],
        ArrowDown: [1, 0],
        ArrowUp: [-1, 0],
      };

      if (moves[evt.key]) {
        evt.preventDefault();
        const [dr, dc] = moves[evt.key];
        focusManualCell(manualNextOpenCell(row, col, dr, dc));
        return;
      }

      if (evt.key === "Backspace" && !input.value) {
        evt.preventDefault();
        const [dr, dc] = manualState.selectedDirection === "down" ? [-1, 0] : [0, -1];
        focusManualCell(manualNextOpenCell(row, col, dr, dc));
      }
    });

    cellEl.appendChild(input);
    manualState.inputEls.set(keyStr, input);
  }

  manualState.cellEls.set(keyStr, cellEl);
  return cellEl;
}

// Swaps a single cell between "black square" and "letter input" presentation
// in place (used only when block-toggling), without rebuilding the rest of
// the grid.
function rebuildManualCell(row, col) {
  const keyStr = manualCellKey(row, col);
  const oldEl = manualState.cellEls.get(keyStr);
  manualState.inputEls.delete(keyStr);
  manualState.numberEls.delete(keyStr);

  const newEl = createManualCellElement(row, col);
  positionManualCell(newEl, row, col);
  if (oldEl && oldEl.parentNode) {
    oldEl.parentNode.replaceChild(newEl, oldEl);
  }
  applyManualHighlight();
}

// Updates which cell/direction is being worked on and re-applies the
// row/column highlight. Direction defaults to "across" whenever a different
// cell is selected; clicking the same cell again is handled by the caller
// passing the flipped direction.
function setManualSelection(row, col, direction) {
  manualState.selectedRow = row;
  manualState.selectedCol = col;
  manualState.selectedDirection = direction || "across";
  applyManualHighlight();
}

// Moves focus to a cell reached via keyboard navigation/auto-advance
// (arrow keys, typing a letter, Backspace), keeping the selection/highlight
// in sync with where focus actually lands. No-ops if there's no target
// (e.g. navigation hit the edge of the sheet).
function focusManualCell(target) {
  if (!target) {
    return;
  }
  setManualSelection(Number(target.dataset.row), Number(target.dataset.col), manualState.selectedDirection);
  target.focus();
}

// Lightly highlights the whole row (across) or column (down) that the
// selected cell belongs to, among the cells currently rendered, plus marks
// the exact selected cell. Reuses the same "active-word"/"active-cell"
// classes the solver page uses for its own word/cell highlighting.
function applyManualHighlight() {
  const { selectedRow, selectedCol, selectedDirection } = manualState;
  manualState.cellEls.forEach((cellEl, keyStr) => {
    if (selectedRow == null || selectedCol == null) {
      cellEl.classList.remove("active-word", "active-cell");
      return;
    }
    const [r, c] = keyStr.split(",").map(Number);
    const inLine = selectedDirection === "down" ? c === selectedCol : r === selectedRow;
    cellEl.classList.toggle("active-word", inLine);
    cellEl.classList.toggle("active-cell", r === selectedRow && c === selectedCol);
  });
}

// Recomputes clue numbering and patches only the number badges that actually
// changed, instead of touching every cell. Keeps this cheap enough to run on
// every keystroke.
function refreshManualNumbering() {
  const slots = computeManualSlots();
  const newNumbering = new Map();
  [...slots.across, ...slots.down].forEach((slot) => {
    newNumbering.set(manualCellKey(slot.row, slot.col), slot.number);
  });

  manualState.lastNumbering.forEach((number, keyStr) => {
    if (newNumbering.get(keyStr) === number) {
      return;
    }
    const numberEl = manualState.numberEls.get(keyStr);
    if (numberEl) {
      numberEl.remove();
      manualState.numberEls.delete(keyStr);
    }
  });

  newNumbering.forEach((number, keyStr) => {
    if (manualState.lastNumbering.get(keyStr) === number) {
      return;
    }
    const cellEl = manualState.cellEls.get(keyStr);
    if (!cellEl) {
      return;
    }
    let numberEl = manualState.numberEls.get(keyStr);
    if (!numberEl) {
      numberEl = document.createElement("span");
      numberEl.className = "cell-num";
      cellEl.prepend(numberEl);
      manualState.numberEls.set(keyStr, numberEl);
    }
    numberEl.textContent = String(number);
  });

  manualState.lastNumbering = newNumbering;
}

// Positions a rendered cell within the canvas based on its absolute
// coordinates (the canvas is absolutely-positioned, not CSS Grid, since only
// a small window of cells is ever rendered at once — see renderManualWindow).
function positionManualCell(cellEl, row, col) {
  cellEl.style.left = `${(col - manualState.minCol) * MANUAL_CELL_PITCH}px`;
  cellEl.style.top = `${(row - manualState.minRow) * MANUAL_CELL_PITCH}px`;
}

// The canvas itself is sized to the full pannable range so the viewport's
// scrollbar/scroll extent reflects the whole graph-paper sheet, even though
// only a window of cells near the current scroll position actually exists
// in the DOM.
function updateManualCanvasSize() {
  const cols = manualState.maxCol - manualState.minCol + 1;
  const rows = manualState.maxRow - manualState.minRow + 1;
  els.manualGrid.style.width = `${cols * MANUAL_CELL_PITCH - MANUAL_GRID_GAP}px`;
  els.manualGrid.style.height = `${rows * MANUAL_CELL_PITCH - MANUAL_GRID_GAP}px`;
}

function computeManualRenderWindow() {
  const viewport = els.manualViewport;
  const firstCol = manualState.minCol + Math.floor(viewport.scrollLeft / MANUAL_CELL_PITCH) - MANUAL_RENDER_BUFFER;
  const lastCol =
    manualState.minCol +
    Math.ceil((viewport.scrollLeft + viewport.clientWidth) / MANUAL_CELL_PITCH) +
    MANUAL_RENDER_BUFFER;
  const firstRow = manualState.minRow + Math.floor(viewport.scrollTop / MANUAL_CELL_PITCH) - MANUAL_RENDER_BUFFER;
  const lastRow =
    manualState.minRow +
    Math.ceil((viewport.scrollTop + viewport.clientHeight) / MANUAL_CELL_PITCH) +
    MANUAL_RENDER_BUFFER;

  return {
    minRow: Math.max(manualState.minRow, firstRow),
    maxRow: Math.min(manualState.maxRow, lastRow),
    minCol: Math.max(manualState.minCol, firstCol),
    maxCol: Math.min(manualState.maxCol, lastCol),
  };
}

// Renders only the cells near the current scroll position, adding newly
// visible cells and dropping ones that scrolled away. This keeps the live
// DOM/input count bounded to roughly the viewport size no matter how far the
// user has panned or expanded the sheet, which is what actually fixes the
// lag (a full rebuild on every keystroke — or even just a huge number of
// live cells — was the real cost, not the per-keystroke logic itself).
function renderManualWindow() {
  updateManualCanvasSize();
  const win = computeManualRenderWindow();

  [...manualState.cellEls.keys()].forEach((keyStr) => {
    const [r, c] = keyStr.split(",").map(Number);
    if (r < win.minRow || r > win.maxRow || c < win.minCol || c > win.maxCol) {
      manualState.cellEls.get(keyStr)?.remove();
      manualState.cellEls.delete(keyStr);
      manualState.inputEls.delete(keyStr);
      manualState.numberEls.delete(keyStr);
    }
  });

  const fragment = document.createDocumentFragment();
  for (let row = win.minRow; row <= win.maxRow; row += 1) {
    for (let col = win.minCol; col <= win.maxCol; col += 1) {
      if (manualState.cellEls.has(manualCellKey(row, col))) {
        continue;
      }
      const cellEl = createManualCellElement(row, col);
      positionManualCell(cellEl, row, col);
      fragment.appendChild(cellEl);
    }
  }
  els.manualGrid.appendChild(fragment);
  els.manualGrid.classList.toggle("block-mode", manualState.blockMode);

  refreshManualNumbering();
  applyManualHighlight();
}

// Renders a specific cell on demand even if it falls outside the normal
// buffered window — used when keyboard navigation (arrow keys, auto-advance,
// Backspace) steps to a neighbor that hasn't been materialized yet, so
// moving focus never silently fails while panning is still catching up.
function ensureManualCellRendered(row, col) {
  const keyStr = manualCellKey(row, col);
  const existing = manualState.inputEls.get(keyStr);
  if (existing) {
    return existing;
  }

  const cellEl = createManualCellElement(row, col);
  positionManualCell(cellEl, row, col);
  els.manualGrid.appendChild(cellEl);
  applyManualHighlight();
  return manualState.inputEls.get(keyStr) || null;
}

function drawManualClues() {
  const slots = computeManualSlots();

  const drawList = (target, entries, direction) => {
    target.innerHTML = "";
    entries.forEach((slot) => {
      const li = document.createElement("li");
      li.className = "manual-clue-item";

      const numberEl = document.createElement("span");
      numberEl.className = "clue-num";
      numberEl.textContent = String(slot.number);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "manual-clue-input";
      input.placeholder = "Clue text";
      input.maxLength = 180;
      input.value = manualState.clueText.get(manualKey(slot.row, slot.col, direction)) || "";
      input.addEventListener("input", (evt) => {
        manualState.clueText.set(manualKey(slot.row, slot.col, direction), evt.target.value);
      });

      li.append(numberEl, input);
      target.appendChild(li);
    });
  };

  drawList(els.manualAcross, slots.across, "across");
  drawList(els.manualDown, slots.down, "down");
}

function centerManualViewport() {
  const viewport = els.manualViewport;
  viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
  viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
}

// When the pannable range grows to the left/up, every already-rendered
// cell's position is relative to the (now-changed) minRow/minCol origin, so
// it must be recomputed — otherwise cells would visually jump out of place
// once the compensating scroll adjustment below is applied.
function repositionRenderedManualCells() {
  manualState.cellEls.forEach((cellEl, keyStr) => {
    const [r, c] = keyStr.split(",").map(Number);
    positionManualCell(cellEl, r, c);
  });
}

function maybeExpandManualGrid() {
  const viewport = els.manualViewport;
  let scrollLeftAdjust = 0;
  let scrollTopAdjust = 0;
  let changed = false;

  if (viewport.scrollLeft < MANUAL_EXPAND_THRESHOLD && manualState.minCol > -MANUAL_MAX_EXTENT) {
    manualState.minCol -= MANUAL_EXPAND_STEP;
    scrollLeftAdjust = MANUAL_EXPAND_STEP * MANUAL_CELL_PITCH;
    changed = true;
  }

  if (
    viewport.scrollLeft + viewport.clientWidth > viewport.scrollWidth - MANUAL_EXPAND_THRESHOLD &&
    manualState.maxCol < MANUAL_MAX_EXTENT
  ) {
    manualState.maxCol += MANUAL_EXPAND_STEP;
    changed = true;
  }

  if (viewport.scrollTop < MANUAL_EXPAND_THRESHOLD && manualState.minRow > -MANUAL_MAX_EXTENT) {
    manualState.minRow -= MANUAL_EXPAND_STEP;
    scrollTopAdjust = MANUAL_EXPAND_STEP * MANUAL_CELL_PITCH;
    changed = true;
  }

  if (
    viewport.scrollTop + viewport.clientHeight > viewport.scrollHeight - MANUAL_EXPAND_THRESHOLD &&
    manualState.maxRow < MANUAL_MAX_EXTENT
  ) {
    manualState.maxRow += MANUAL_EXPAND_STEP;
    changed = true;
  }

  if (changed) {
    repositionRenderedManualCells();
    viewport.scrollLeft += scrollLeftAdjust;
    viewport.scrollTop += scrollTopAdjust;
    renderManualWindow();
  }
}

function computeManualBounds() {
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;

  manualState.cells.forEach((cell, key) => {
    const [row, col] = key.split(",").map(Number);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
  });

  return { minRow, maxRow, minCol, maxCol };
}

function setMakerMode(mode) {
  const isAutomatic = mode === "automatic";
  els.automaticSection.classList.toggle("hidden", !isAutomatic);
  els.manualSection.classList.toggle("hidden", isAutomatic);
  els.modeAutomaticBtn.classList.toggle("active", isAutomatic);
  els.modeManualBtn.classList.toggle("active", !isAutomatic);
  els.modeAutomaticBtn.setAttribute("aria-selected", String(isAutomatic));
  els.modeManualBtn.setAttribute("aria-selected", String(!isAutomatic));

  if (!isAutomatic) {
    // The viewport has real dimensions only once it's visible, so the
    // rendered window must be (re)computed each time it's shown.
    renderManualWindow();
    if (!manualState.centered) {
      manualState.centered = true;
      centerManualViewport();
      renderManualWindow();
    }
  }
}

function createEntryRow(answer = "", clue = "") {
  const row = document.createElement("div");
  row.className = "entry-row";

  const clueLabel = document.createElement("label");
  clueLabel.textContent = "Clue";
  const clueInput = document.createElement("input");
  clueInput.className = "entry-clue";
  clueInput.type = "text";
  clueInput.placeholder = "Clue text";
  clueInput.maxLength = 180;
  clueInput.value = clue;
  clueLabel.appendChild(clueInput);

  const answerLabel = document.createElement("label");
  answerLabel.textContent = "Answer";
  const answerInput = document.createElement("input");
  answerInput.className = "entry-answer";
  answerInput.type = "text";
  answerInput.placeholder = "ANSWER";
  answerInput.maxLength = 32;
  answerInput.value = answer;
  answerLabel.appendChild(answerInput);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-row-btn";
  removeBtn.textContent = "Remove";

  row.append(clueLabel, answerLabel, removeBtn);
  return row;
}

function renderPlacementReport(report) {
  if (!report || report.unplaced.length === 0) {
    els.reportBox.classList.add("hidden");
    els.unplacedList.innerHTML = "";
    return;
  }

  els.reportBox.classList.remove("hidden");
  els.reportSummary.textContent = `Placed ${report.placedCount} of ${report.totalEntries} entries. ${report.unplaced.length} could not be placed.`;
  els.unplacedList.innerHTML = "";

  report.unplaced.forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = `${entry.answer}: ${entry.reason} Suggestion: ${entry.suggestion}`;
    els.unplacedList.appendChild(li);
  });
}

function collectEntries() {
  const rows = [...els.entryRows.querySelectorAll(".entry-row")];
  return rows
    .map((row) => {
      const answerInput = row.querySelector(".entry-answer");
      const clueInput = row.querySelector(".entry-clue");
      const answer = (answerInput?.value || "")
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .trim();
      const clue = (clueInput?.value || "").trim();
      return { answer, clue };
    })
    .filter((entry) => entry.answer.length > 1 && entry.clue.length > 0);
}

function rowsPayload() {
  return [...els.entryRows.querySelectorAll(".entry-row")].map((row) => {
    const answerInput = row.querySelector(".entry-answer");
    const clueInput = row.querySelector(".entry-clue");
    return {
      answer: answerInput?.value || "",
      clue: clueInput?.value || "",
    };
  });
}

function setRows(rows) {
  els.entryRows.innerHTML = "";
  const source = rows.length > 0 ? rows : Array.from({ length: 5 }, () => ({ answer: "", clue: "" }));
  source.forEach((entry) => {
    els.entryRows.appendChild(createEntryRow(entry.answer || "", entry.clue || ""));
  });
}

function setMessage(text, isBad = false) {
  els.message.textContent = text;
  els.message.classList.toggle("bad", isBad);
  els.message.classList.toggle("good", !isBad);
}

function drawGrid(puzzle) {
  els.grid.innerHTML = "";
  els.grid.style.gridTemplateColumns = `repeat(${puzzle.cols}, 36px)`;

  const numbering = new Map();
  const clueStarts = puzzle.clueStarts || { across: [], down: [] };
  [...clueStarts.across, ...clueStarts.down].forEach((start) => {
    numbering.set(`${start.row},${start.col}`, start.number);
  });

  for (let row = 0; row < puzzle.rows; row += 1) {
    for (let col = 0; col < puzzle.cols; col += 1) {
      const cell = puzzle.grid[row][col];
      const cellEl = document.createElement("div");
      cellEl.className = "cell";
      if (cell.block) {
        cellEl.classList.add("black");
      } else {
        const num = numbering.get(`${row},${col}`);
        if (num) {
          const numberEl = document.createElement("span");
          numberEl.className = "cell-num";
          numberEl.textContent = String(num);
          cellEl.appendChild(numberEl);
        }

        const input = document.createElement("input");
        input.readOnly = true;
        input.value = cell.solution;
        input.tabIndex = -1;
        cellEl.appendChild(input);
      }

      els.grid.appendChild(cellEl);
    }
  }
}

function drawClues(puzzle) {
  const drawList = (target, clues) => {
    target.innerHTML = "";
    const direction = target === els.across ? "across" : "down";
    const clueStarts = puzzle.clueStarts || { across: [], down: [] };
    clueStarts[direction].forEach((start) => {
      const number = start.number;
        const li = document.createElement("li");
      li.textContent = `${number}. ${clues[number] || "(clue not set)"}`;
        target.appendChild(li);
    });
  };

  drawList(els.across, puzzle.clues.across);
  drawList(els.down, puzzle.clues.down);
}

function renderPuzzle(puzzle) {
  drawGrid(puzzle);
  drawClues(puzzle);
  els.panel.classList.remove("hidden");
}

function payload() {
  return {
    title: els.title.value,
    author: els.author.value,
    generationMode: els.generationMode.value,
    entryRows: rowsPayload(),
    puzzle: state.puzzle,
  };
}

function generate() {
  const entries = collectEntries();
  try {
    const result = buildPuzzleWithReport({
      title: els.title.value,
      author: els.author.value,
      entries,
      options: {
        mode: els.generationMode.value,
      },
    });
    const { puzzle, report } = result;
    state.puzzle = puzzle;
    renderPuzzle(puzzle);
    renderPlacementReport(report);
    setMessage(`Generated ${puzzle.rows}x${puzzle.cols} crossword from ${report.placedCount} placed entries.`);
  } catch (error) {
    renderPlacementReport(null);
    setMessage(error.message, true);
  }
}

els.addRowBtn.addEventListener("click", () => {
  els.entryRows.appendChild(createEntryRow());
});

els.entryRows.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.classList.contains("remove-row-btn")) {
    return;
  }

  const rows = els.entryRows.querySelectorAll(".entry-row");
  if (rows.length <= 1) {
    const row = rows[0];
    const answerInput = row.querySelector(".entry-answer");
    const clueInput = row.querySelector(".entry-clue");
    if (answerInput) {
      answerInput.value = "";
    }
    if (clueInput) {
      clueInput.value = "";
    }
    return;
  }

  target.closest(".entry-row")?.remove();
});

els.generateBtn.addEventListener("click", generate);

els.modeAutomaticBtn.addEventListener("click", () => setMakerMode("automatic"));
els.modeManualBtn.addEventListener("click", () => setMakerMode("manual"));

let manualRenderQueued = false;
function scheduleManualWindowRender() {
  if (manualRenderQueued) {
    return;
  }
  manualRenderQueued = true;
  requestAnimationFrame(() => {
    manualRenderQueued = false;
    renderManualWindow();
  });
}

els.manualViewport.addEventListener("scroll", () => {
  maybeExpandManualGrid();
  scheduleManualWindowRender();
});

els.manualRecenterBtn.addEventListener("click", () => {
  centerManualViewport();
});

els.manualBlockToggleBtn.addEventListener("click", () => {
  manualState.blockMode = !manualState.blockMode;
  els.manualBlockToggleBtn.textContent = `Toggle Black Squares: ${manualState.blockMode ? "On" : "Off"}`;
  els.manualBlockToggleBtn.setAttribute("aria-pressed", String(manualState.blockMode));
  els.manualBlockToggleBtn.classList.toggle("active", manualState.blockMode);
  els.manualGrid.classList.toggle("block-mode", manualState.blockMode);
});

els.manualClearBtn.addEventListener("click", () => {
  [...manualState.cells.entries()].forEach(([key, cell]) => {
    if (!cell.block) {
      manualState.cells.delete(key);
    }
  });
  manualState.inputEls.forEach((input) => {
    input.value = "";
  });
  refreshManualNumbering();
  drawManualClues();
  setMessage("Cleared all letters from the manual grid.");
});

els.manualBuildBtn.addEventListener("click", () => {
  const bounds = computeManualBounds();
  if (!Number.isFinite(bounds.minRow)) {
    setMessage("Add some letters to the grid before building.", true);
    return;
  }

  const rows = bounds.maxRow - bounds.minRow + 1;
  const cols = bounds.maxCol - bounds.minCol + 1;
  const grid = [];

  // A cell inside the bounding rectangle that was never filled in or marked
  // black is just empty space around an irregularly-shaped set of words
  // (e.g. a plus/cross layout), not a square the user forgot about — treat
  // it as a black square automatically instead of forcing the user to click
  // every corner of the rectangle by hand. This mirrors how numbering
  // already treats untouched cells (see computeManualSlots).
  for (let r = 0; r < rows; r += 1) {
    const gridRow = [];
    for (let c = 0; c < cols; c += 1) {
      const cell = getManualCell(bounds.minRow + r, bounds.minCol + c);
      const isBlock = cell.block || !cell.solution;
      gridRow.push({ block: isBlock, solution: isBlock ? "" : cell.solution });
    }
    grid.push(gridRow);
  }

  const slots = computeSlots(grid, rows, cols);
  if (slots.across.length + slots.down.length === 0) {
    setMessage("Add at least one across or down word (2+ letters) before building.", true);
    return;
  }

  const puzzle = {
    title: els.title.value.trim() || "Untitled Puzzle",
    author: els.author.value.trim() || "unknown",
    rows,
    cols,
    grid,
    clues: { across: {}, down: {} },
    clueStarts: { across: [], down: [] },
  };

  slots.across.forEach((slot) => {
    const text = manualState.clueText.get(manualKey(bounds.minRow + slot.row, bounds.minCol + slot.col, "across")) || "";
    puzzle.clues.across[slot.number] = text.trim() || "(clue not set)";
    puzzle.clueStarts.across.push({ number: slot.number, row: slot.row, col: slot.col });
  });

  slots.down.forEach((slot) => {
    const text = manualState.clueText.get(manualKey(bounds.minRow + slot.row, bounds.minCol + slot.col, "down")) || "";
    puzzle.clues.down[slot.number] = text.trim() || "(clue not set)";
    puzzle.clueStarts.down.push({ number: slot.number, row: slot.row, col: slot.col });
  });

  state.puzzle = puzzle;
  renderPuzzle(puzzle);
  setMessage(`Built ${rows}x${cols} crossword from the manual grid.`);
});

function applyPayload(parsed) {
  const normalized = normalizeDraftPayload(parsed);

  els.title.value = normalized.title;
  els.author.value = normalized.author;
  els.generationMode.value = normalized.generationMode;
  setRows(normalized.entryRows);
  state.puzzle = normalized.puzzle;
  if (state.puzzle) {
    renderPuzzle(state.puzzle);
    setMessage("Loaded puzzle draft.");
  } else {
    setMessage("Loaded saved input rows.");
  }
}

function generateDraftId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadDraftsList() {
  try {
    const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDraftsList(drafts) {
  localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

// Older versions of the maker only supported a single overwritable draft
// under STORAGE_KEY. Fold that into the new named-drafts list once (if any
// exists and nothing has been saved under the new scheme yet) so upgrading
// doesn't silently lose someone's in-progress puzzle.
function migrateLegacyDraft() {
  const legacy = localStorage.getItem(STORAGE_KEY);
  if (!legacy) {
    return;
  }

  const drafts = loadDraftsList();
  if (drafts.length === 0) {
    try {
      const parsed = JSON.parse(legacy);
      drafts.push({
        id: generateDraftId(),
        name: parsed.title?.trim() || "Untitled Draft",
        savedAt: Date.now(),
        data: parsed,
      });
      saveDraftsList(drafts);
    } catch {
      // Legacy data wasn't valid JSON — nothing worth migrating.
    }
  }
  localStorage.removeItem(STORAGE_KEY);
}

function renderSavedDrafts() {
  const drafts = loadDraftsList().sort((a, b) => b.savedAt - a.savedAt);
  els.savedDraftsEmpty.classList.toggle("hidden", drafts.length > 0);
  els.savedDraftsList.innerHTML = "";

  drafts.forEach((draft) => {
    const li = document.createElement("li");
    li.className = "saved-draft-item";

    const nameEl = document.createElement("span");
    nameEl.className = "saved-draft-name";
    nameEl.textContent = draft.name;
    nameEl.title = new Date(draft.savedAt).toLocaleString();

    const actions = document.createElement("div");
    actions.className = "saved-draft-actions";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "secondary-btn";
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", () => {
      const fresh = loadDraftsList().find((d) => d.id === draft.id);
      if (!fresh) {
        setMessage("That draft no longer exists.", true);
        renderSavedDrafts();
        return;
      }
      applyPayload(fresh.data);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "secondary-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      saveDraftsList(loadDraftsList().filter((d) => d.id !== draft.id));
      renderSavedDrafts();
      setMessage(`Deleted draft "${draft.name}".`);
    });

    actions.append(loadBtn, deleteBtn);
    li.append(nameEl, actions);
    els.savedDraftsList.appendChild(li);
  });
}

// Uses the async Clipboard API where available (requires a secure context),
// falling back to a hidden-textarea + execCommand copy for contexts like
// file:// pages where navigator.clipboard may not be exposed.
async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const temp = document.createElement("textarea");
  temp.value = text;
  temp.style.position = "fixed";
  temp.style.opacity = "0";
  document.body.appendChild(temp);
  temp.focus();
  temp.select();
  const ok = document.execCommand("copy");
  temp.remove();
  return ok;
}

els.shareBtn.addEventListener("click", () => {
  if (!state.puzzle) {
    setMessage("Generate a crossword before sharing.", true);
    return;
  }

  const encoded = encodePayload(state.puzzle);
  const url = `${window.location.origin}${window.location.pathname.replace("maker.html", "solver.html")}#p=${encoded}`;
  els.shareUrl.value = url;
  window.history.replaceState(null, "", `#p=${encoded}`);
  setMessage("Solver link generated.");
});

els.copyLinkBtn.addEventListener("click", async () => {
  if (!els.shareUrl.value) {
    setMessage("Generate a solver link first.", true);
    return;
  }

  try {
    const ok = await copyTextToClipboard(els.shareUrl.value);
    if (ok) {
      setMessage("Solver link copied to clipboard.");
    } else {
      els.shareUrl.select();
      setMessage("Couldn't copy automatically — link is selected, press Ctrl/Cmd+C.", true);
    }
  } catch {
    els.shareUrl.select();
    setMessage("Couldn't copy automatically — link is selected, press Ctrl/Cmd+C.", true);
  }
});

els.saveBtn.addEventListener("click", () => {
  const name = els.saveNameInput.value.trim() || els.title.value.trim() || "Untitled Draft";
  const drafts = loadDraftsList();
  const existingIndex = drafts.findIndex((d) => d.name.toLowerCase() === name.toLowerCase());
  const entry = {
    id: existingIndex >= 0 ? drafts[existingIndex].id : generateDraftId(),
    name,
    savedAt: Date.now(),
    data: payload(),
  };

  if (existingIndex >= 0) {
    drafts[existingIndex] = entry;
  } else {
    drafts.push(entry);
  }

  saveDraftsList(drafts);
  renderSavedDrafts();
  setMessage(`Saved draft "${name}" in this browser.`);
});

els.downloadBtn.addEventListener("click", () => {
  const data = payload();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const safeName = (els.saveNameInput.value.trim() || els.title.value.trim() || "crossword").replace(/[^a-z0-9-_]+/gi, "_");

  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setMessage("Downloaded puzzle as a .json file.");
});

els.uploadInput.addEventListener("change", async (evt) => {
  const file = evt.target.files?.[0];
  evt.target.value = "";
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    applyPayload(parsed);
    setMessage(`Loaded "${file.name}" from disk.`);
  } catch {
    setMessage("That file isn't a valid crossword export.", true);
  }
});

migrateLegacyDraft();
renderSavedDrafts();
setRows(rowsPayload());
renderManualWindow();
drawManualClues();
