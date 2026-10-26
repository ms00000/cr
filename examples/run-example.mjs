import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const fixture = JSON.parse(await readFile(join(here, 'deck-templates.json'), 'utf8'));
const cardKeys = [...new Set([...fixture.required, ...fixture.optional, ...fixture.templates.flatMap((template) => template.cards)])];
const cardMeta = cardKeys.map((key) => {
  const variant = key.split(':').at(-1);
  const rarity = ['REQ-00:base', 'REQ-02:base'].includes(key) || variant === 'hero' ? 'champion' : 'common';
  return { variant, rarity };
});
const { encodeSyntheticDecks } = await import('./decks-binary.mjs');
const input = { required: fixture.required, optional: fixture.optional, excluded: fixture.excluded, cardKeys, cardMeta, dataVersion: fixture.dataVersion, binary: encodeSyntheticDecks(cardKeys, fixture.templates) };
globalThis.self = globalThis;
await import('../src/decks-format.js');
const { runV2Search } = await import('../src/expert-search-core-v2.mjs');
const loadHighs = (await import('../src/vendor/highs.mjs')).default;
const highs = await loadHighs({ locateFile: (file) => pathToFileURL(join(root, 'src', 'vendor', file)).href });
const result = await runV2Search(input, highs);
if (!result.ok || result.optimalityProven !== true) throw new Error(`Exact solve failed: ${result.errorMessage || result.reason || 'unproven result'}`);
const output = {
  solver: 'V2 exact MILP with bundled HiGHS WebAssembly',
  optimalityProven: result.optimalityProven,
  requiredUsed: `${result.debug.reqUsed}/${fixture.required.length}`,
  optionalUsed: `${result.debug.optUsed}/${fixture.optional.length}`,
  totalCards: result.debug.totalCards,
  duplicateCards: result.debug.duplicateCards,
  sortedTemplateOverlap: result.overlapVector,
  templateUsage: result.debug.templateUsages,
  templateUsageSum: result.templateUsageSum,
  groups: result.groups.map((group, index) => ({ label: String.fromCharCode(65 + index), cards: group.final, sourceTemplate: group.template, overlap: `${group.overlap}/8`, templateUsage: group.templateUsage })),
  searchMs: result.debug.searchMs,
  solverVersion: result.debug.solverVersion
};
const rendered = `${JSON.stringify(output, null, 2)}\n`;
await writeFile(join(here, 'output.json'), rendered, 'utf8');
process.stdout.write(rendered);
