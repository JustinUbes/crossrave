const ALPHABET_ONLY = /[^A-Z]/g;

function key(row, col) {
  return `${row},${col}`;
}

function parseKey(raw) {
  const [row, col] = raw.split(",").map(Number);
  return { row, col };
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  // Standard base64 uses "+" and "/", which either need percent-encoding in
  // a URL or (worse) get silently misread as a space by URLSearchParams.
  // The base64url variant (RFC 4648 §5) swaps those out and drops padding,
  // so the result is already safe to drop straight into a URL fragment.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodePayload(payload) {
  const json = JSON.stringify(payload);
  return bytesToBase64Url(new TextEncoder().encode(json));
}

export function decodePayload(encoded) {
  // Current format: base64url of the raw UTF-8 JSON bytes (no
  // encodeURIComponent step) — shorter, and immune to "+" being misread as
  // a space. Falls back to the older btoa(encodeURIComponent(json)) format
  // so links generated before this change keep working.
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(encoded));
    return JSON.parse(json);
  } catch {
    return JSON.parse(decodeURIComponent(atob(encoded)));
  }
}

export function parseEntryLines(raw) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .map((line) => {
      const [left, ...rest] = line.split(":");
      const answer = (left || "").trim().toUpperCase().replace(ALPHABET_ONLY, "");
      const clue = rest.join(":").trim();
      return { answer, clue };
    })
    .filter((entry) => entry.answer.length > 1);
}

function canPlaceWord(letterMap, row, col, dir, word) {
  const dr = dir === "down" ? 1 : 0;
  const dc = dir === "across" ? 1 : 0;

  const beforeKey = key(row - dr, col - dc);
  const afterKey = key(row + dr * word.length, col + dc * word.length);
  if (letterMap.has(beforeKey) || letterMap.has(afterKey)) {
    return { ok: false, intersects: 0 };
  }

  let intersects = 0;

  for (let i = 0; i < word.length; i += 1) {
    const rr = row + dr * i;
    const cc = col + dc * i;
    const here = key(rr, cc);
    const existing = letterMap.get(here);

    if (existing && existing !== word[i]) {
      return { ok: false, intersects: 0 };
    }

    if (existing === word[i]) {
      intersects += 1;
      continue;
    }

    if (dir === "across") {
      if (letterMap.has(key(rr - 1, cc)) || letterMap.has(key(rr + 1, cc))) {
        return { ok: false, intersects: 0 };
      }
    } else if (letterMap.has(key(rr, cc - 1)) || letterMap.has(key(rr, cc + 1))) {
      return { ok: false, intersects: 0 };
    }
  }

  return { ok: true, intersects };
}

function placeWord(letterMap, placement, word) {
  const dr = placement.dir === "down" ? 1 : 0;
  const dc = placement.dir === "across" ? 1 : 0;
  for (let i = 0; i < word.length; i += 1) {
    const rr = placement.row + dr * i;
    const cc = placement.col + dc * i;
    letterMap.set(key(rr, cc), word[i]);
  }
}

function computeBounds(letterMap) {
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = -Infinity;
  let maxCol = -Infinity;

  letterMap.forEach((_value, raw) => {
    const { row, col } = parseKey(raw);
    minRow = Math.min(minRow, row);
    minCol = Math.min(minCol, col);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
  });

  return { minRow, minCol, maxRow, maxCol };
}

function scorePlacement(letterMap, candidate, word, mode) {
  const bounds = computeBounds(letterMap);
  const dr = candidate.dir === "down" ? 1 : 0;
  const dc = candidate.dir === "across" ? 1 : 0;

  let minRow = bounds.minRow;
  let minCol = bounds.minCol;
  let maxRow = bounds.maxRow;
  let maxCol = bounds.maxCol;

  for (let i = 0; i < word.length; i += 1) {
    const rr = candidate.row + dr * i;
    const cc = candidate.col + dc * i;
    minRow = Math.min(minRow, rr);
    minCol = Math.min(minCol, cc);
    maxRow = Math.max(maxRow, rr);
    maxCol = Math.max(maxCol, cc);
  }

  const area = (maxRow - minRow + 1) * (maxCol - minCol + 1);
  if (mode === "maxIntersections") {
    return candidate.intersects * 1000 - area;
  }

  return candidate.intersects * 100 - area;
}

function suggestionForUnplaced(word, letterMap, mode) {
  const placedLetters = new Set(letterMap.values());
  const hasSharedLetter = [...word].some((char) => placedLetters.has(char));

  if (!hasSharedLetter) {
    return "Add words that share letters with current placed entries.";
  }

  if (word.length >= 10) {
    return "Try shorter or bridge words first, then re-introduce this entry.";
  }

  if (mode === "maxIntersections") {
    return "Switch to Compactness mode to relax crossing density constraints.";
  }

  return "Switch to Max Intersections mode and try adding related vocabulary.";
}

function generatePlacements(entries, mode) {
  const sorted = [...entries].sort((a, b) => b.answer.length - a.answer.length);
  const letterMap = new Map();
  const placements = [];
  const unplaced = [];

  if (sorted.length === 0) {
    return { placements, letterMap, unplaced };
  }

  sorted.forEach((entry, index) => {
    const word = entry.answer;
    if (index === 0) {
      const first = { row: 0, col: 0, dir: "across", intersects: 0, ...entry };
      placeWord(letterMap, first, word);
      placements.push(first);
      return;
    }

    const candidates = [];
    letterMap.forEach((letter, rawKey) => {
      const { row, col } = parseKey(rawKey);
      for (let i = 0; i < word.length; i += 1) {
        if (word[i] !== letter) {
          continue;
        }

        const across = {
          row,
          col: col - i,
          dir: "across",
          intersects: 0,
        };
        const acrossFit = canPlaceWord(letterMap, across.row, across.col, across.dir, word);
        if (acrossFit.ok && acrossFit.intersects > 0) {
          candidates.push({ ...across, intersects: acrossFit.intersects });
        }

        const down = {
          row: row - i,
          col,
          dir: "down",
          intersects: 0,
        };
        const downFit = canPlaceWord(letterMap, down.row, down.col, down.dir, word);
        if (downFit.ok && downFit.intersects > 0) {
          candidates.push({ ...down, intersects: downFit.intersects });
        }
      }
    });

    if (candidates.length === 0) {
      unplaced.push({
        answer: word,
        clue: entry.clue,
        reason: "No valid crossing location found.",
        suggestion: suggestionForUnplaced(word, letterMap, mode),
      });
      return;
    }

    candidates.sort((a, b) => scorePlacement(letterMap, b, word, mode) - scorePlacement(letterMap, a, word, mode));
    const chosen = candidates[0];

    const placement = { ...chosen, ...entry };
    placeWord(letterMap, placement, word);
    placements.push(placement);
  });

  return { placements, letterMap, unplaced };
}

// Numbers every across/down slot of length >= 2 in an arbitrary grid, the way a
// newspaper crossword is numbered. Used by the manual grid builder where the
// grid isn't produced by the automatic word-placement algorithm.
export function computeSlots(grid, rows, cols) {
  const across = [];
  const down = [];
  let number = 1;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (grid[row][col].block) {
        continue;
      }

      const leftBlocked = col === 0 || grid[row][col - 1].block;
      const rightOpen = col + 1 < cols && !grid[row][col + 1].block;
      const topBlocked = row === 0 || grid[row - 1][col].block;
      const bottomOpen = row + 1 < rows && !grid[row + 1][col].block;

      const startsAcross = leftBlocked && rightOpen;
      const startsDown = topBlocked && bottomOpen;

      if (!startsAcross && !startsDown) {
        continue;
      }

      if (startsAcross) {
        let length = 0;
        let c = col;
        while (c < cols && !grid[row][c].block) {
          length += 1;
          c += 1;
        }
        across.push({ number, row, col, length });
      }

      if (startsDown) {
        let length = 0;
        let r = row;
        while (r < rows && !grid[r][col].block) {
          length += 1;
          r += 1;
        }
        down.push({ number, row, col, length });
      }

      number += 1;
    }
  }

  return { across, down };
}

export function computeClueStarts(puzzle) {
  const starts = [];
  let number = 1;

  for (let row = 0; row < puzzle.rows; row += 1) {
    for (let col = 0; col < puzzle.cols; col += 1) {
      if (puzzle.grid[row][col].block) {
        continue;
      }

      const startsAcross = col === 0 || puzzle.grid[row][col - 1].block;
      const startsDown = row === 0 || puzzle.grid[row - 1][col].block;

      if (startsAcross || startsDown) {
        starts.push({ number, row, col, across: startsAcross, down: startsDown });
        number += 1;
      }
    }
  }

  return starts;
}

export function buildPuzzleFromEntries({ title, author, entries }) {
  const { puzzle } = buildPuzzleWithReport({ title, author, entries });
  return puzzle;
}

export function buildPuzzleWithReport({ title, author, entries, options = {} }) {
  if (!entries || entries.length < 3) {
    throw new Error("Need at least 3 entries to generate a crossword.");
  }

  const cleaned = entries
    .map((entry) => ({
      answer: (entry.answer || "").toUpperCase().replace(ALPHABET_ONLY, ""),
      clue: (entry.clue || "").trim(),
    }))
    .filter((entry) => entry.answer.length > 1 && entry.clue.length > 0);

  if (cleaned.length < 3) {
    throw new Error("Need at least 3 valid answer/clue pairs to generate a crossword.");
  }

  const mode = options.mode === "maxIntersections" ? "maxIntersections" : "compactness";

  const { placements, letterMap, unplaced } = generatePlacements(cleaned, mode);
  if (placements.length === 0 || letterMap.size === 0) {
    throw new Error("Could not place entries. Try adding words that share letters.");
  }

  const bounds = computeBounds(letterMap);
  const rows = bounds.maxRow - bounds.minRow + 1;
  const cols = bounds.maxCol - bounds.minCol + 1;

  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ block: true, solution: "" })),
  );

  letterMap.forEach((letter, raw) => {
    const { row, col } = parseKey(raw);
    const rr = row - bounds.minRow;
    const cc = col - bounds.minCol;
    grid[rr][cc] = { block: false, solution: letter };
  });

  const puzzle = {
    title: title?.trim() || "Untitled Puzzle",
    author: author?.trim() || "unknown",
    rows,
    cols,
    grid,
    clues: { across: {}, down: {} },
    clueStarts: { across: [], down: [] },
  };

  const starts = computeClueStarts(puzzle);
  const numberByCoord = new Map();
  starts.forEach((start) => {
    numberByCoord.set(key(start.row, start.col), start.number);
  });

  placements.forEach((placement) => {
    const row = placement.row - bounds.minRow;
    const col = placement.col - bounds.minCol;
    const number = numberByCoord.get(key(row, col));
    if (!number) {
      return;
    }

    if (placement.dir === "across") {
      puzzle.clues.across[number] = placement.clue || "(clue not set)";
      puzzle.clueStarts.across.push({ number, row, col });
    } else {
      puzzle.clues.down[number] = placement.clue || "(clue not set)";
      puzzle.clueStarts.down.push({ number, row, col });
    }
  });

  puzzle.clueStarts.across.sort((a, b) => a.number - b.number);
  puzzle.clueStarts.down.sort((a, b) => a.number - b.number);

  const report = {
    mode,
    totalEntries: cleaned.length,
    placedCount: placements.length,
    unplaced,
  };

  return { puzzle, report };
}
