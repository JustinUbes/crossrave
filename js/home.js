import { encodePayload } from "./puzzle.js";
import { FEATURED_PUZZLE } from "./featured-puzzle.js";

const els = {
  title: document.getElementById("home-title"),
  author: document.getElementById("home-author"),
  across: document.getElementById("home-across-count"),
  down: document.getElementById("home-down-count"),
  solveLink: document.getElementById("solve-featured-link"),
};

els.title.textContent = FEATURED_PUZZLE.title;
els.author.textContent = `by ${FEATURED_PUZZLE.author}`;
els.across.textContent = String(Object.keys(FEATURED_PUZZLE.clues.across).length);
els.down.textContent = String(Object.keys(FEATURED_PUZZLE.clues.down).length);

const encoded = encodePayload(FEATURED_PUZZLE);
els.solveLink.href = `solver.html#p=${encoded}`;
