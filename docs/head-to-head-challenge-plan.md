# Plan: Head-to-Head Challenge Mode (Issue #9)

**Status:** Planning document only — no implementation yet, no architecture change.
**Constraint:** Crossrave stays a static GitHub Pages site (HTML/CSS/vanilla JS). No backend, no accounts, no database.

## Why this needs a plan

A "true" head-to-head system (synced records, live results, verified identity) requires a
server. That is out of scope for our architecture and this plan does **not** propose adding one.
Instead, it maps a fully **serverless** path that reuses two mechanisms the site already has:

- **`#p=` hash links** — puzzles are already shared entirely inside the URL fragment.
- **`crossrave`-prefixed localStorage** — the Maker already persists drafts locally.

## Serverless data flow (the "diagram")

```
 CHALLENGER (Maker)                          SOLVER (friend)
 ┌──────────────────────┐                    ┌──────────────────────┐
 │ Build puzzle          │  challenge link   │ Open link            │
 │ + name, target time   │ ────────────────► │ Banner: "Alex        │
 │ encoded in #c= params │   (text/email/    │ challenges you —     │
 └──────────────────────┘    chat — any      │ beat 4:32"           │
            ▲                channel)        │ Solve (timed;        │
            │                                │ checks/reveals       │
            │   result link                  │ counted)             │
 ┌──────────┴───────────┐ ◄──────────────────│ Finish → result link │
 │ Open result link     │                    │ (#r= params: time,   │
 │ → outcome recorded   │                    │ aids used, names)    │
 │ in localStorage      │                    └──────────┬───────────┘
 │ head-to-head record  │                               │ also records own
 └──────────────────────┘                               ▼ side locally
                              Each browser keeps its own per-opponent
                              win/loss history (per-device, unsynced)
```

No server ever sees the puzzle, the result, or the names. The "network" is the two humans
exchanging links.

## Phased delivery (each phase independently shippable)

### Phase 0 — Prerequisites (already tracked as separate issues)
- **#12 Solve timer** — challenge mode is meaningless without timing. *(in progress)*
- **#11 Completion detection** — needed to know when/how a solve finished. *(in progress)*
- **#10 Granular check/reveal** — needed to count "aids used" honestly.

### Phase 1 — Challenge links (Maker side)
- Maker gains a "Challenge a friend" option when generating a share link.
- Extra hash params alongside `#p=`: challenger display name, optional target time.
- Payload stays inside the URL fragment (same encoding approach as `#p=`); no new storage.

### Phase 2 — Challenge solve experience (Solver side)
- Solver detects challenge params and shows a banner: who made it, target to beat.
- Timer runs; check/reveal usage is tallied during the solve.
- Completion screen shows the outcome vs. the target.

### Phase 3 — Result links
- Completion screen produces a copyable "result link" encoding: solver name, time,
  checks/reveals used, and a puzzle identifier (hash of the `#p=` payload).
- Opening a result link shows a readable result card to the challenger.
- Honesty note: results are self-reported and trivially editable — v1 accepts this
  (it's a game between friends, not a leaderboard). A lightweight checksum can deter
  casual tampering but cannot prevent it without a server.

### Phase 4 — Local head-to-head records
- Opening a result link (challenger side) or finishing a challenge (solver side)
  appends the outcome to a `crossrave.records` localStorage structure keyed by
  opponent name.
- A small "Records" section (Home page or a modal) lists per-opponent W-L history.
- Records are per-device and unsynced — stated plainly in the UI.

## Explicitly out of scope (would require architecture change)
- Real-time play, live presence, spectating.
- Server-synced or cross-device records; global leaderboards.
- Accounts, identity verification, or anti-cheat beyond casual deterrence.

If demand ever justifies those, the decision to add a backend should be its own
proposal — nothing in Phases 1–4 blocks or presupposes it.
