# Crosswordsmith

Crosswordsmith is a static website skeleton for building and sharing crossword puzzles.
It runs fully in the browser with plain HTML, CSS, and JavaScript.

## What This Skeleton Includes

- Home page:
- Landing page for your project
- Shows a featured puzzle entry point for everyone to solve
- Featured puzzle can be pinned by editing one file
- Maker page:
- Row-based clue/answer entry UI
- Add/remove entry rows in a scrollable list
- Generation strategy control: compactness or max intersections
- Auto-generates a crossword with variable dimensions based on the entries
- No fixed 10x10 assumption
- Fallback report for entries that could not be placed, with suggestions
- Solver page:
- Loads a puzzle from hash payload (`#p=...`)
- Shows no crossword grid until a puzzle is loaded
- Lets players fill, check, reveal, and reset
- Share system with no server:
- Encodes puzzle data into URL hash for link-based sharing
- Browser local save/load:
- Saves latest maker draft in localStorage

## Project Structure

- `index.html` home landing page
- `maker.html` crossword generator page
- `solver.html` crossword solver page
- `css/styles.css` shared visual system and responsive layout
- `js/puzzle.js` shared puzzle utilities and word-list crossword generation
- `js/maker.js` maker page behavior
- `js/solver.js` solver page behavior
- `js/home.js` home page behavior
- `js/featured-puzzle-source.js` single source file to edit the pinned home puzzle
- `js/featured-puzzle.js` builds the featured puzzle from source data
- `.nojekyll` ensures smooth GitHub Pages static file handling

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

## Deploy To GitHub Pages

1. Push this repository to your GitHub account.
2. In GitHub, go to repository settings.
3. Open Pages settings.
4. Set source to deploy from your default branch and root folder (`/`).
5. Save and wait for deployment.

The app uses relative asset paths, so it works for both:

- User/organization pages (`https://username.github.io`)
- Project pages (`https://username.github.io/repo-name`)

## How Sharing Works

1. Build puzzle in Maker by feeding words and clues.
2. Click Generate Solver Link.
3. Send generated URL to another person.
4. When they open it, the puzzle loads in Solver automatically.

If someone opens Solver without a hash payload, no puzzle grid is shown by default.

Note: URL hash payloads can become large for very big puzzles.

## Next Feature Ideas

- Add manual placement override tools in Maker
- Add import/export JSON file buttons
- Add keyboard navigation by clue direction
- Printable crossword layout
- Optional validation for unchecked letters
