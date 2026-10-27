# Clash Royale Deck Template Optimizer

A constraint-based optimizer for building four Clash Royale war decks from a shared card pool.

Each card can appear in only one deck. All required cards must be included, optional selections must fill the remaining slots, and the resulting decks should match historically successful eight-card templates as closely as possible.

**Live website:** https://crapi.pages.dev/

## Background

I have played Clash Royale since its launch in 2016. Community resources such as RoyaleAPI and Supercell's public game data inspired me to explore historical deck patterns and build a working deck optimization tool.

This repository presents the extracted V2 optimization engine for technical review. It is not a copy of the full website, and the production deck dataset is not distributed here.

## How it works

Given historical eight-card templates, card metadata, and required, optional, and excluded card selections, the solver constructs four non-overlapping decks of eight cards each.

It enforces the following constraints:

- Every required card must be used.
- Optional cards fill the remaining slots to reach 32 unique cards.
- Excluded cards cannot be selected.
- No card may appear in more than one deck.
- Each deck may contain at most two Evolution cards.
- Each deck must contain exactly one Champion or Hero card.
- Reference templates must meet a minimum historical Usage of 20.

### Optimization objective

The solver uses a lexicographic optimization strategy:

1. Maximize the minimum template overlap across the four decks.
2. Maximize total template overlap.
3. Prefer a more balanced overlap distribution.
4. Maximize the sum of historical template Usage.

These objectives are solved in priority order rather than combined into an arbitrary weighted score.

The solver reports `optimalityProven: true` only when the required mathematical optimization stages have been proven optimal or infeasible.

## Implementation

The project includes:

- The extracted production V2 optimization core.
- The production CRD2 binary deck parser.
- A bundled HiGHS WebAssembly optimization runtime.
- A synthetic CRD2 fixture generator.
- A reproducible example and automated tests.

No production deck records or real player selections are included.

## Run the example

**Requirements:** Node.js 20 or newer. No npm package dependencies.

Run the synthetic example:

`npm run example`

Run the automated tests:

`npm test`

The example starts with 20 required cards and 19 optional cards. It selects 12 optional cards to complete four eight-card decks, covering all 20 required cards without duplication.

In this synthetic scenario, each generated deck reaches a 7/8 overlap with its reference template.

The output includes deck compositions, template Usage, solver version, and mathematical optimality status.

Example results are saved to `examples/output.json`.

## Repository structure

- `src/expert-search-core-v2.mjs` — optimization core and solution verification.
- `src/decks-format.js` — CRD2 binary format parser.
- `src/vendor/` — HiGHS WebAssembly runtime and its original license.
- `examples/` — synthetic fixture, encoder, executable example, and output.
- `test/` — constraint, parser-integrity, and infeasibility tests.

## Source availability and permissions

This repository is published for technical review and educational inspection. It is not offered as an unrestricted open-source software project.

Please refer to the repository's `LICENSE` file for the permissions applicable to the original project code. Third-party components remain subject to their respective licenses.

## Disclaimer

This is an unofficial community project and is not affiliated with, endorsed by, or sponsored by Supercell.

Clash Royale names and trademarks belong to their respective owners.
