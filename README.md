# Clash Royale Deck Template Optimizer

Four war decks share one card pool. A card spent in one deck is unavailable to the next, every required card must be used, and a set of individually popular cards is not automatically a good deck. This project solves that allocation problem against historical eight-card templates.

I have played Clash Royale since its 2016 launch. Community resources such as RoyaleAPI make the game’s history easier to study, and Supercell’s public game data helped me build a live deck tool. I extracted this optimizer from that working project so developers can inspect and run its core without the website or its private dataset.

## What it does

Given historical eight-card templates, card metadata, and required, optional, and excluded selections, the V2 solver chooses four groups of eight. It uses only the selected pool, covers every required card, uses enough optional cards to reach 32 total, and prevents duplicates across groups. It also enforces the production rules: at most two Evo cards and exactly one Champion/Hero card per group.

Templates must meet the production Usage floor of 20. The exact objective is lexicographic: maximize the weakest template overlap, maximize total overlap, prefer a balanced overlap vector, then maximize summed template Usage. There is no weighted-score shortcut or best-so-far result presented as optimal. optimalityProven is true only after the MILP stages have been proven optimal or infeasible.

The project includes the production CRD2 binary parser and bundled HiGHS WebAssembly solver. A small encoder creates a synthetic CRD2 fixture for the runnable example; no production decks or player selections are included.

## Run it

Requires Node.js 20 or newer. There are no npm package dependencies.

`sh
npm run example
npm test
`

The example prints four allocations, overlap, source-template Usage, solver version, and proof status. Its fixture uses 20 required and 19 optional cards. The expected result is 20 required plus 12 optional, 32 unique cards, and a 7/8 overlap for every template. The generated output is also checked in at xamples/output.json.

## Project layout

- src/expert-search-core-v2.mjs — extracted exact search and output verification.
- src/decks-format.js — the compact CRD2 parser used by the site.
- src/vendor/ — HiGHS WebAssembly runtime and original license.
- xamples/ — synthetic input, CRD2 encoder, runnable entry point, and output.
- 	est/ — constraint, parser-integrity, and infeasibility tests using Node’s built-in test runner.

This is an unofficial community project. It is not affiliated with, endorsed by, or sponsored by Supercell. Clash Royale names and marks belong to their respective owners. No game art or proprietary historical dataset is distributed here.