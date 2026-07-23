# Repository Agents

This repository uses workspace-local crossword agents:

- [crossword-owner](agents/crossword-owner.agent.md) — Product owner and orchestrator. Triages GitHub Issues, plans work, delegates to the specialist agents below, and verifies results before closing the loop. Start here for "work on issue #N" or roadmap/priority decisions.
- [crossword-scrum](agents/crossword-scrum.agent.md) — Scrum master. Feed it a feature idea and it breaks it into well-formed GitHub Issues (user stories, acceptance criteria, duplicate checks) and files them via the `gh` CLI with your approval.
- [crossword-dev](agents/crossword-dev.agent.md) — Expert front-end developer. Fixes bugs and improves responsiveness, mobile layout, keyboard navigation, accessibility, and performance to match industry-standard crossword sites (NYT, LA Times, Washington Post).
- [Crossword Maker](agents/crossword-maker.agent.md) — Crossword constructor. Use for puzzle creation, solving, clue review, difficulty tuning, and grid-quality feedback.
- [crossword-user](agents/crossword-user.agent.md) — Everyday solver persona. Use for playtesting, puzzle critique (clue fairness, fill, difficulty), and usability reviews comparing Crossrave to industry-standard sites.

Repository-wide guidance is also defined in [copilot-instructions.md](copilot-instructions.md).
