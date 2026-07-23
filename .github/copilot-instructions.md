# Crossrave Repo Instructions

This repository is Crossrave, a static GitHub Pages crossword site served at crossrave.com (see `CNAME`). Follow these rules when editing it:

- Keep the stack limited to HTML, CSS, and JavaScript.
- Do not introduce Node, backend services, or build steps unless explicitly requested.
- Preserve the Home, Maker, and Solver page split.
- Keep the featured daily puzzle sourced from `js/featured-puzzle-source.js`.
- Prefer small, focused edits over broad rewrites.
- Use relative paths so the site works on GitHub Pages project and user pages.
- Validate touched files after edits when possible.
- Keep crossword behavior fair, newspaper-like, and solvable.
- Avoid copying published crossword clues or grids verbatim.
- Favor concise clues with a mix of straightforward and witty phrasing.
- If a change touches puzzle generation or solving, keep the flow compatible with the current static site architecture.
- Use the name "Crossrave" consistently; do not reintroduce old names (Crosswordsmith, crosslark). localStorage keys are `crossrave`-prefixed, with a migration path from old keys.

## Agents and Skills

- Workspace agents are defined in `.github/agents/` and indexed in `AGENTS.md`:
  - `crossword-owner` — product owner/orchestrator; triages GitHub Issues and delegates to the other agents.
  - `crossword-scrum` — scrum master; turns feature ideas into well-formed GitHub Issues via the `github-connect` skill.
  - `crossword-dev` — front-end development, accessibility, responsiveness, and UX polish.
  - `Crossword Maker` — puzzle creation, clue writing, difficulty tuning, grid quality.
  - `crossword-user` — everyday-solver persona for playtesting and usability feedback.
- Delegate to the most relevant agent when a task matches its domain; prefer `crossword-owner` for issue-driven or multi-agent work.
- Use the `github-connect` skill (`.github/skills/github-connect/`) for GitHub Issue/PR work via the `gh` CLI; write actions (commenting, closing, pushing) require explicit user approval.
- When adding or renaming agents or skills, keep `AGENTS.md` in sync.
