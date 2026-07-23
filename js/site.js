// Shared site chrome: theme toggle + help dialog, used by all three pages.

const THEME_STORAGE_KEY = "crossrave-theme";

function storedTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme, themeButton) {
  document.documentElement.dataset.theme = theme;
  if (themeButton) {
    const toDark = theme !== "dark";
    themeButton.textContent = toDark ? "\u263E Dark" : "\u2600 Light";
    themeButton.setAttribute("aria-label", toDark ? "Switch to dark theme" : "Switch to light theme");
  }
}

const HELP_HTML = `
  <h2 id="help-dialog-title">How to Play</h2>
  <h3>Solving</h3>
  <ul>
    <li>Type letters to fill squares — input is auto-capitalized and the cursor advances. At the end of a word it jumps to the next clue.</li>
    <li><kbd>Backspace</kbd> clears the current square and steps back within the word.</li>
    <li>Arrow keys move through the grid and skip black squares: <kbd>\u2190</kbd> <kbd>\u2192</kbd> switch to Across, <kbd>\u2191</kbd> <kbd>\u2193</kbd> switch to Down.</li>
    <li>Click the square you are already on to toggle between Across and Down.</li>
    <li>Click any clue in the lists to jump straight to its word.</li>
    <li>Above the grid: <strong>Check Fill</strong> marks right/wrong letters, <strong>Reveal Puzzle</strong> fills the solution, <strong>Clear Fill</strong> starts over, and <strong>Print</strong> makes a paper copy. <strong>Pause</strong> hides the grid and stops the timer.</li>
  </ul>
  <h3>Making Puzzles</h3>
  <ul>
    <li><strong>Automatic mode:</strong> enter at least 3 answer + clue rows, pick a strategy (Compactness or Max Intersections), then click Generate Crossword.</li>
    <li><strong>Manual mode:</strong> type letters straight onto the open grid, or turn on \u201CToggle Black Squares\u201D to click squares into blocks. Numbering updates as you edit; fill in the clues and click Build Puzzle.</li>
    <li><strong>Sharing:</strong> Generate Solver Link encodes the whole puzzle in the URL, so anyone with the link can solve it. You can also save drafts in this browser or download/upload them as .json.</li>
  </ul>
  <div class="dialog-actions">
    <button type="button" class="dialog-close-btn">Close</button>
  </div>
`;

function buildHelpDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "site-dialog help-dialog";
  dialog.setAttribute("aria-labelledby", "help-dialog-title");
  dialog.innerHTML = HELP_HTML;
  dialog.querySelector(".dialog-close-btn").addEventListener("click", () => dialog.close());
  document.body.appendChild(dialog);
  return dialog;
}

function initSiteChrome() {
  const nav = document.querySelector(".top-nav");
  if (!nav) {
    return;
  }

  const helpButton = document.createElement("button");
  helpButton.type = "button";
  helpButton.className = "nav-btn";
  helpButton.textContent = "Help";

  const themeButton = document.createElement("button");
  themeButton.type = "button";
  themeButton.className = "nav-btn";

  nav.appendChild(helpButton);
  nav.appendChild(themeButton);

  applyTheme(currentTheme(), themeButton);

  themeButton.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next, themeButton);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference simply won't persist without storage access.
    }
  });

  // Follow live system theme changes until the visitor picks one explicitly.
  if (window.matchMedia) {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = (evt) => {
      if (!storedTheme()) {
        applyTheme(evt.matches ? "dark" : "light", themeButton);
      }
    };
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onSystemChange);
    }
  }

  let helpDialog = null;
  helpButton.addEventListener("click", () => {
    if (!helpDialog) {
      helpDialog = buildHelpDialog();
    }
    helpDialog.showModal();
  });
}

initSiteChrome();
