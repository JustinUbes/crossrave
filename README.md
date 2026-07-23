# Crossrave

Crossrave is a website for building, sharing, and solving crossword puzzles,
live at [crossrave.com](https://crossrave.com). It runs fully in the browser
with plain HTML, CSS, and JavaScript — no accounts, no server, no build step.

## Features

- Home page:
- Landing page for the site
- Shows a featured daily puzzle entry point for everyone to solve
- Featured puzzle can be pinned by editing one file
- Maker page:
- Automatic mode: row-based clue/answer entry UI
  - Add/remove entry rows in a scrollable list
  - Generation strategy control: compactness or max intersections
  - Auto-generates a crossword with variable dimensions based on the entries
  - No fixed 10x10 assumption
  - Fallback report for entries that could not be placed, with suggestions
- Manual mode: type letters directly onto an unbounded graph-paper grid
  - Pan/scroll infinitely in any direction; the grid keeps extending
  - Clue numbers appear only at true word starts (a cell can carry both an
    across and a down number)
  - Click a cell to highlight its row (across, the default); click the same
    cell again to switch to its column (down), toggling back and forth
  - Typing, arrow keys, and Backspace all follow the active direction
  - Toggle black squares on/off; untouched blank cells are treated as black
    squares automatically when building, so odd-shaped layouts (crosses,
    plusses, etc.) don't need every corner blocked out by hand
- Solver page:
- Loads a puzzle from a hash payload (`#p=...`), a pasted solver link, or the
  featured puzzle (`#featured=1`)
- Shows no crossword grid until a puzzle is loaded
- Newspaper-style navigation: click-to-toggle across/down, keyboard-driven
  fill, clue list synced with the active cell
- Lets players fill, check, reveal, and reset
- Responsive grid sizing with scroll handling for large puzzles
- Share system with no server:
- Encodes puzzle data into a URL hash for link-based sharing
- One-click Copy Link button next to the generated solver URL
- Browser local save/load:
- Save named drafts in `localStorage` (list with per-draft Load/Delete)
- Download the current draft as a `.json` file, or upload one back in
- `crossrave`-prefixed storage keys, with automatic migration from keys saved
  under the project's earlier names
- No accounts, no cookies, no server-side storage

## Project Structure

- `index.html` home landing page
- `maker.html` crossword generator page
- `solver.html` crossword solver page
- `css/styles.css` shared visual system and responsive layout
- `js/puzzle.js` shared puzzle utilities and word-list crossword generation
- `js/maker.js` maker page behavior (automatic + manual grid builder)
- `js/solver.js` solver page behavior
- `js/home.js` home page behavior
- `js/featured-puzzle-source.js` single source file to edit the pinned home puzzle
- `js/featured-puzzle.js` builds the featured puzzle from source data
- `CNAME` custom domain configuration (crossrave.com)
- `.nojekyll` ensures smooth GitHub Pages static file handling
- `.github/CODEOWNERS` default reviewers for pull requests
- `.github/copilot-instructions.md` repository-wide guidance for AI-assisted edits
- `.github/agents/` workspace agents for development, puzzle making,
  playtesting, and issue-driven planning (indexed in `.github/AGENTS.md`)
- `.github/skills/github-connect/` skill for GitHub Issue/PR work via the `gh` CLI

## Pinned Featured Puzzle Workflow

1. Open `js/featured-puzzle-source.js`.
2. Edit `title`, `author`, and `entries`.
3. Optionally set `options.mode` to `compactness` or `maxIntersections`.
4. Save and deploy; the homepage featured puzzle updates automatically.

## Run Locally

Since this is a static site, you can open `index.html` directly in a browser.
For best behavior, use a simple local static server.

Example with Python:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deployment

The site is deployed with GitHub Pages from the default branch root (`/`) and
served at the custom domain [crossrave.com](https://crossrave.com) via the
`CNAME` file. Pushing to `main` publishes automatically.

The app uses relative asset paths, so it also works without the custom domain:

- User/organization pages (`https://username.github.io`)
- Project pages (`https://username.github.io/repo-name`)

## How Sharing Works

1. Build a puzzle in Maker (automatic word entry or the manual grid).
2. Click Generate Solver Link, then Copy Link.
3. Send the copied URL to another person.
4. When they open it, the puzzle loads in Solver automatically — or they can
   paste the link into the "Open a Solver Link" field on the Solver page
   instead of editing the browser address bar by hand.

If someone opens Solver without a hash payload or pasted link, no puzzle grid
is shown by default.

Note: URL hash payloads can still become large for very big puzzles (grid
data grows with rows × cols, and clue text adds up too), so link length is
something to keep in mind for oversized grids. Puzzle data is base64url-encoded
directly from its UTF-8 bytes (no intermediate `encodeURIComponent` step),
which keeps links roughly half the size of a naively-encoded payload and
avoids `+` characters being misread as spaces by some link handling. Links
generated by older versions of this app still open correctly.

## How Data Is Stored

Crossrave has no backend, no accounts, and no cookies — nothing ties a
puzzle to a particular person.

- **Solver links carry the whole puzzle.** The puzzle data is
  base64/URL-encoded directly into the link itself (`#p=...`). Anyone with the
  link can open it; there's no database lookup behind it. Saving/bookmarking
  the link is a fully valid way to keep a puzzle indefinitely.
- **Saved drafts live in `localStorage`**, scoped to one browser on one
  origin. Multiple named drafts can be saved from the Maker page and
  loaded/deleted later, but they won't follow you to another browser or
  device, and clearing site data removes them.
- **Downloaded `.json` files** are the most durable option — they're real
  files on disk that can be backed up, emailed, or re-uploaded into the Maker
  on any browser or device.
- **Solving progress isn't saved anywhere.** The Solver page's fill-in state
  lives only in memory for that page load; refreshing loses it. Only the
  puzzle definition (via the link) persists.

## Next Feature Ideas

- Printable crossword layout
- Optional validation for unchecked letters
- Touch/drag panning polish for the manual grid on mobile

