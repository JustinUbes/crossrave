import { buildPuzzleWithReport } from "./puzzle.js";
import { FEATURED_PUZZLE_SOURCE } from "./featured-puzzle-source.js";

export const FEATURED_PUZZLE = buildPuzzleWithReport({
  title: FEATURED_PUZZLE_SOURCE.title,
  author: FEATURED_PUZZLE_SOURCE.author,
  entries: FEATURED_PUZZLE_SOURCE.entries,
  options: FEATURED_PUZZLE_SOURCE.options,
}).puzzle;
