const REQUIRED_CARDS = 8;
const GROUPS = 4;
const TEMPLATE_USAGE_FLOOR = 20;
const MAX_EVO = 2;
const MAX_CHAMPION_HERO = 2;
const EXACT_CHAMPION_HERO = 1;

const slotBit = (slot) => 1n << BigInt(slot);
const safeProgress = (callback, value) => { try { callback(value); } catch (_) { /* Progress is nonessential. */ } };

function fail(reason, message, debug = {}, optimalityProven = false) {
  return { type: 'result', mode: 'V2', ok: false, complete: true, best: null, reason, errorMessage: message,
    optimalityProven, debug: { searchMode: 'V2', optimalityProven, ...debug } };
}

function validateInput(data) {
  const required = Array.isArray(data.required) ? data.required.map(String) : [];
  const optional = Array.isArray(data.optional) ? data.optional.map(String) : [];
  const excluded = Array.isArray(data.excluded) ? data.excluded.map(String) : [];
  if (required.length > 32) return { error: 'v2-req-overflow' };
  if (new Set(required).size !== required.length || new Set(optional).size !== optional.length ||
      required.some((key) => optional.includes(key)) || required.some((key) => excluded.includes(key)) ||
      optional.some((key) => excluded.includes(key))) return { error: 'v2-invalid-selection' };
  if (required.length + optional.length < 32) return { error: 'v2-pool-short' };
  const cardKeys = Array.isArray(data.cardKeys) ? data.cardKeys.map(String) : [];
  const meta = Array.isArray(data.cardMeta) ? data.cardMeta : [];
  if (!cardKeys.length || meta.length !== cardKeys.length) return { error: 'v2-card-data-invalid' };
  const cardIndex = new Map(cardKeys.map((key, index) => [key, index]));
  const unavailable = [...required, ...optional].filter((key) => !cardIndex.has(key));
  if (unavailable.length) return { error: 'v2-selected-card-missing', unavailable };
  return { required, optional, excluded, cardKeys, meta, cardIndex };
}

function countBits(mask) {
  let n = 0;
  while (mask) { mask &= mask - 1n; n += 1; }
  return n;
}

function buildDominantTemplates(binary, cardKeys, selectedKeys, floor) {
  const selectedSlotByCard = new Int32Array(cardKeys.length);
  selectedSlotByCard.fill(-1);
  const cardIndex = new Map(cardKeys.map((key, index) => [key, index]));
  selectedKeys.forEach((key, slot) => { selectedSlotByCard[cardIndex.get(key)] = slot; });
  const bestByMask = new Map();
  let rawAtFloor = 0;
  for (let deckIndex = 0; deckIndex < binary.deckCount; deckIndex += 1) {
    const usage = binary.usages[deckIndex];
    if (usage < floor) continue;
    rawAtFloor += 1;
    let mask = 0n;
    const base = deckIndex * 8;
    for (let slot = 0; slot < 8; slot += 1) {
      const selectedSlot = selectedSlotByCard[binary.deckCards[base + slot]];
      if (selectedSlot >= 0) mask |= slotBit(selectedSlot);
    }
    const previous = bestByMask.get(mask);
    if (!previous || usage > previous.usage) bestByMask.set(mask, { usage, deckIndices: [deckIndex] });
    else if (usage === previous.usage) previous.deckIndices.push(deckIndex);
  }
  const templates = [];
  for (const [mask, value] of bestByMask) {
    for (const deckIndex of value.deckIndices) templates.push({ mask, overlapCap: countBits(mask), usage: value.usage, deckIndex });
  }
  // Same selected-slot mask means every possible projected group has exactly
  // the same overlap and legality options. A lower-Usage source is dominated
  // for priorities 1-3 and cannot win priority 4; equal-best source decks are
  // retained, matching the exact offline experiment's tie policy.
  templates.sort((a, b) => a.deckIndex - b.deckIndex);
  return { templates, rawAtFloor, dominantCount: templates.length };
}

function addTermMap(terms) {
  const merged = new Map();
  for (const [index, value] of terms) merged.set(index, (merged.get(index) || 0) + value);
  return [...merged].filter(([, value]) => value !== 0);
}

function createMilp(highs, candidates, required, optional, meta, threshold, progressState) {
  const n = candidates.length;
  const slotCount = required.length + optional.length;
  const xCount = GROUPS * slotCount;
  const zCount = GROUPS * slotCount;
  const columnCount = xCount + zCount + GROUPS * n;
  const model = highs.createModel();
  const integer = highs.constants.variableType.integer;
  const x = (group, slot) => group * slotCount + slot;
  const z = (group, slot) => xCount + group * slotCount + slot;
  const y = (group, candidate) => xCount + zCount + group * n + candidate;
  const rowIndices = [];
  for (let column = 0; column < columnCount; column += 1) {
    model.addVar(0, 1);
    model.changeColIntegrality(column, integer);
  }
  const addRow = (lower, upper, terms) => {
    const clean = addTermMap(terms);
    model.addRow(lower, upper, {
      indices: Int32Array.from(clean, ([index]) => index),
      values: Float64Array.from(clean, ([, value]) => value)
    });
    rowIndices.push(clean.map(([index]) => index));
  };
  const infinity = highs.infinity;
  for (let slot = 0; slot < slotCount; slot += 1) {
    const terms = Array.from({ length: GROUPS }, (_, group) => [x(group, slot), 1]);
    addRow(slot < required.length ? 1 : 0, 1, terms);
  }
  const evoSlots = [], championHeroSlots = [];
  for (let slot = 0; slot < slotCount; slot += 1) {
    const card = meta.get(required[slot] ?? optional[slot - required.length]);
    if (card?.variant === 'ev1') evoSlots.push(slot);
    if (card?.variant === 'hero' || card?.rarity === 'champion') championHeroSlots.push(slot);
  }
  for (let group = 0; group < GROUPS; group += 1) {
    addRow(REQUIRED_CARDS, REQUIRED_CARDS, Array.from({ length: slotCount }, (_, slot) => [x(group, slot), 1]));
    addRow(1, 1, Array.from({ length: n }, (_, candidate) => [y(group, candidate), 1]));
    addRow(threshold, REQUIRED_CARDS, Array.from({ length: slotCount }, (_, slot) => [z(group, slot), 1]));
    addRow(0, MAX_EVO, evoSlots.map((slot) => [x(group, slot), 1]));
    addRow(EXACT_CHAMPION_HERO, EXACT_CHAMPION_HERO, championHeroSlots.map((slot) => [x(group, slot), 1]));
    addRow(0, MAX_CHAMPION_HERO, championHeroSlots.map((slot) => [x(group, slot), 1]));
    for (let slot = 0; slot < slotCount; slot += 1) {
      const contained = [];
      for (let candidate = 0; candidate < n; candidate += 1) {
        if (candidates[candidate].mask & slotBit(slot)) contained.push([y(group, candidate), 1]);
      }
      addRow(-infinity, 0, [[z(group, slot), 1], [x(group, slot), -1]]);
      addRow(-infinity, 0, [[z(group, slot), 1], ...contained.map(([index]) => [index, -1])]);
      // Lower half of z = x AND selectedTemplateContains(slot): when both are
      // one this row forces z to one. Keep the negative y coefficient here.
      addRow(-1, infinity, [[z(group, slot), 1], [x(group, slot), -1], ...contained.map(([index]) => [index, -1])]);
    }
    if (group > 0) addRow(0, infinity, Array.from({ length: slotCount }, (_, slot) => [[z(group, slot), 1], [z(group - 1, slot), -1]]).flat());
  }
  model.options.set({ output_flag: false, presolve: 'on', mip_rel_gap: 0, mip_abs_gap: 0 });
  model.changeObjectiveSense(highs.constants.objectiveSense.maximize);
  progressState.columns = columnCount;
  progressState.rows = rowIndices.length;
  return { model, x, z, y, n, slotCount, columnCount };
}

function optimizeModel(highs, built, candidates, threshold, progress) {
  const { model, x, z, y, n, slotCount, columnCount } = built;
  let priorCostIndices = [];
  let warmStart = null;
  let nodes = 0;
  const stages = [];
  const callbacks = {
    [highs.constants.callbackType.mipLogging](event) {
      const now = performance.now();
      if (now - progress.lastPost < 650) return;
      progress.lastPost = now;
      const data = event.data || {};
      progress.emit({
        phase: progress.stage, threshold, templateCandidates: n,
        nodes: data.mip_node_count == null ? nodes : Number(data.mip_node_count),
        incumbent: Number.isFinite(data.mip_primal_bound) ? data.mip_primal_bound : null,
        bound: Number.isFinite(data.mip_dual_bound) ? data.mip_dual_bound : null,
        solverElapsedMs: Math.round((data.running_time || 0) * 1000)
      });
    }
  };
  const solveObjective = (terms, stageName, proveValue = true) => {
    for (const index of priorCostIndices) model.changeColCost(index, 0);
    const clean = addTermMap(terms);
    priorCostIndices = clean.map(([index]) => index);
    for (const [index, coefficient] of clean) model.changeColCost(index, coefficient);
    if (warmStart) model.setSolution({ colValue: warmStart });
    progress.stage = stageName;
    progress.emit({ phase: stageName, threshold, templateCandidates: n, nodes, incumbent: null, bound: null });
    const started = performance.now();
    model.run(callbacks);
    const elapsedMs = performance.now() - started;
    const status = model.getModelStatus();
    const stageNodes = Number(model.info.get('mip_node_count') || 0);
    nodes += stageNodes;
    if (status === highs.constants.modelStatus.infeasible) {
      stages.push({ stage: stageName, status: 'infeasible', nodes: stageNodes, elapsedMs });
      return null;
    }
    if (status !== highs.constants.modelStatus.optimal) {
      throw new Error(`HiGHS did not prove an optimum at ${stageName}; model status ${status}`);
    }
    warmStart = Float64Array.from(model.getSolution().colValue);
    const objectiveValue = Math.round(model.getObjectiveValue());
    stages.push({ stage: stageName, status: 'optimal', objective: objectiveValue, nodes: stageNodes, elapsedMs });
    if (proveValue) model.addRow(objectiveValue, objectiveValue, {
      indices: Int32Array.from(clean, ([index]) => index),
      values: Float64Array.from(clean, ([, coefficient]) => coefficient)
    });
    return objectiveValue;
  };

  const totalTerms = [];
  for (let group = 0; group < GROUPS; group += 1) for (let slot = 0; slot < slotCount; slot += 1) totalTerms.push([z(group, slot), 1]);
  const totalOverlap = solveObjective(totalTerms, 'maximize total overlap');
  if (totalOverlap == null) return { feasible: false, nodes, stages };
  // The model orders group overlaps nondecreasingly. Encode the resulting
  // 4-digit vector exactly in base 9 (each digit is 0..8): maximizing this
  // integer is mathematically identical to lexicographically maximizing the
  // balanced vector, not a heuristic weighted blend of different priorities.
  const balanceTerms = [];
  for (let group = 0; group < GROUPS; group += 1) {
    const place = (REQUIRED_CARDS + 1) ** (GROUPS - group - 1);
    for (let slot = 0; slot < slotCount; slot += 1) balanceTerms.push([z(group, slot), place]);
  }
  const balanceCode = solveObjective(balanceTerms, 'lexicographically maximize balanced overlap vector (exact base-9 encoding)');
  if (balanceCode == null) throw new Error('A fixed feasible V2 model became infeasible during balanced-vector optimization');
  const vector = Array.from({ length: GROUPS }, (_, group) => {
    let overlap = 0;
    for (let slot = 0; slot < slotCount; slot += 1) overlap += warmStart[z(group, slot)] > 0.5 ? 1 : 0;
    return overlap;
  });
  const decodedBalanceCode = vector.reduce((value, overlap) => value * (REQUIRED_CARDS + 1) + overlap, 0);
  if (decodedBalanceCode !== balanceCode) throw new Error('Exact base-9 balance encoding did not match the recovered overlap vector');
  const usageTerms = [];
  for (let group = 0; group < GROUPS; group += 1) {
    for (let candidate = 0; candidate < n; candidate += 1) usageTerms.push([y(group, candidate), candidates[candidate].usage]);
  }
  const templateUsageSum = solveObjective(usageTerms, 'maximize template Usage');
  if (templateUsageSum == null) throw new Error('A fixed feasible V2 model became infeasible during template Usage optimization');
  return { feasible: true, nodes, stages, totalOverlap, vector, templateUsageSum, solution: warmStart, indices: { x, z, y }, columns: columnCount };
}

function extractAndVerify(solution, candidates, binary, input, meta, threshold) {
  const { required, optional, excluded } = input;
  const chosen = [...required, ...optional];
  const groups = [];
  for (let group = 0; group < GROUPS; group += 1) {
    const finalSlots = [];
    for (let slot = 0; slot < chosen.length; slot += 1) if (solution.solution[solution.indices.x(group, slot)] > 0.5) finalSlots.push(slot);
    const chosenTemplate = candidates.findIndex((_, candidate) => solution.solution[solution.indices.y(group, candidate)] > 0.5);
    if (finalSlots.length !== 8 || chosenTemplate < 0) throw new Error(`Invalid exact V2 group ${group}`);
    const templateSource = candidates[chosenTemplate];
    const sourceStart = templateSource.deckIndex * 8;
    const template = Array.from(binary.deckCards.subarray(sourceStart, sourceStart + 8), (index) => input.cardKeys[index]);
    const final = finalSlots.map((slot) => chosen[slot]);
    const overlap = final.reduce((sum, key) => sum + (template.includes(key) ? 1 : 0), 0);
    const solverOverlap = finalSlots.reduce((sum, slot) => sum + (solution.solution[solution.indices.z(group, slot)] > 0.5 ? 1 : 0), 0);
    const evoCount = final.reduce((sum, key) => sum + (meta.get(key)?.variant === 'ev1' ? 1 : 0), 0);
    const championHeroCount = final.reduce((sum, key) => sum + (meta.get(key)?.variant === 'hero' || meta.get(key)?.rarity === 'champion' ? 1 : 0), 0);
    if (overlap < threshold || evoCount > MAX_EVO || championHeroCount !== EXACT_CHAMPION_HERO || championHeroCount > MAX_CHAMPION_HERO) {
      throw new Error(`Exact V2 output failed constraints in group ${group}: overlap=${overlap}/${threshold}, solverOverlap=${solverOverlap}, templateIndex=${templateSource.deckIndex}, evo=${evoCount}, championHero=${championHeroCount}, cards=${final.join(',')}, template=${template.join(',')}`);
    }
    groups.push({
      final, template, templateIndex: templateSource.deckIndex, overlap,
      templateUsage: binary.usages[templateSource.deckIndex], wins: binary.wins[templateSource.deckIndex],
      losses: binary.losses[templateSource.deckIndex], selectedEvoCount: evoCount,
      selectedChampionHeroCount: championHeroCount
    });
  }
  const flat = groups.flatMap((group) => group.final);
  const unique = new Set(flat);
  const reqUsed = required.filter((key) => unique.has(key)).length;
  const optUsed = optional.filter((key) => unique.has(key)).length;
  const duplicates = flat.length - unique.size;
  const outside = flat.filter((key) => !required.includes(key) && !optional.includes(key));
  if (flat.length !== 32 || duplicates || outside.length || reqUsed !== required.length || optUsed !== 32 - required.length || flat.some((key) => excluded.includes(key))) {
    throw new Error('Exact V2 output failed selected-pool coverage or uniqueness verification');
  }
  groups.sort((a, b) => a.overlap - b.overlap || a.templateIndex - b.templateIndex);
  return { groups, reqUsed, optUsed, duplicates, outsideCount: outside.length, totalCards: flat.length };
}

export async function runV2Search(data, highs, onProgress = () => {}) {
  const started = performance.now();
  const input = validateInput(data);
  if (input.error === 'v2-req-overflow') return fail(input.error, input.error, { reqUsed: data.required?.length || 0, templateUsageFloor: TEMPLATE_USAGE_FLOOR });
  if (input.error === 'v2-pool-short') return fail(input.error, input.error, { reqCount: data.required?.length || 0, availableCount: (data.required?.length || 0) + (data.optional?.length || 0), templateUsageFloor: TEMPLATE_USAGE_FLOOR });
  if (input.error) return fail(input.error, input.error, { unavailable: input.unavailable || [], templateUsageFloor: TEMPLATE_USAGE_FLOOR });
  const meta = new Map(input.cardKeys.map((key, index) => [key, input.meta[index]]));
  const emit = (patch) => safeProgress(onProgress, { type: 'progress', debug: {
    searchMode: 'V2', templateUsageFloor: TEMPLATE_USAGE_FLOOR,
    reqCount: input.required.length, optCount: input.optional.length,
    rawDeckCount: 0, candidateTemplates: 0, thresholdCandidates: 0,
    states: 0, solverNodes: 0, phase: 'initializing', elapsedMs: Math.round(performance.now() - started),
    optimalityProven: false, ...patch
  } });
  const selected = [...input.required, ...input.optional];
  if (!(data.binary instanceof ArrayBuffer)) return fail('v2-data-invalid', 'missing-binary-buffer');
  if (!globalThis.CRDDecks?.parse) throw new Error('CRDDecks parser is not available in the V2 Worker');
  emit({ phase: 'parsing binary' });
  const parseStarted = performance.now();
  const binary = globalThis.CRDDecks.parse(data.binary, input.cardKeys);
  const parseMs = performance.now() - parseStarted;
  emit({ phase: 'scanning templates', rawDeckCount: binary.deckCount, parseMs: Math.round(parseMs) });
  const scanStarted = performance.now();
  const compressed = buildDominantTemplates(binary, input.cardKeys, selected, TEMPLATE_USAGE_FLOOR);
  const scanMs = performance.now() - scanStarted;
  const baseDebug = {
    searchMode: 'V2', templateUsageFloor: TEMPLATE_USAGE_FLOOR, rawDeckCount: binary.deckCount,
    rawTemplatesAtUsageFloor: compressed.rawAtFloor, candidateTemplates: compressed.dominantCount,
    templateScanMs: Math.round(scanMs), parseMs: Math.round(parseMs),
    reqCount: input.required.length, optCount: input.optional.length, dataVersion: data.dataVersion || null
  };
  if (!compressed.templates.length) return fail('v2-no-feasible', 'no-templates-at-usage-floor', { ...baseDebug, states: 0, searchMs: Math.round(performance.now() - started) }, true);
  const evoCountBySlot = selected.map((key) => meta.get(key)?.variant === 'ev1');
  const championHeroCountBySlot = selected.map((key) => meta.get(key)?.variant === 'hero' || meta.get(key)?.rarity === 'champion');
  const proof = [];
  let totalNodes = 0;
  let best = null;
  for (let threshold = 8; threshold >= 0; threshold -= 1) {
    const candidates = compressed.templates.filter((candidate) => candidate.overlapCap >= threshold);
    const boundary = { threshold, candidateTemplates: candidates.length, status: candidates.length ? 'pending' : 'proven-empty-upper-bound', nodes: 0 };
    proof.push(boundary);
    if (!candidates.length) continue;
    emit({ ...baseDebug, phase: `prove minimum overlap ${threshold}/8`, thresholdCandidates: candidates.length, states: totalNodes, solverNodes: totalNodes });
    const milp = createMilp(highs, candidates, input.required, input.optional, meta, threshold, {
      columns: 0, rows: 0, stage: 'build model', lastPost: 0,
      emit: (progress) => emit({ ...baseDebug, ...progress, thresholdCandidates: candidates.length, states: totalNodes + (progress.nodes || 0), solverNodes: totalNodes + (progress.nodes || 0) })
    });
    let optimized;
    try { optimized = optimizeModel(highs, milp, candidates, threshold, {
      stage: 'exact MILP', lastPost: 0,
      emit: (progress) => emit({ ...baseDebug, ...progress, thresholdCandidates: candidates.length, states: totalNodes + (progress.nodes || 0), solverNodes: totalNodes + (progress.nodes || 0) })
    }); }
    finally { milp.model.dispose(); }
    totalNodes += optimized.nodes;
    boundary.nodes = optimized.nodes;
    boundary.stages = optimized.stages;
    boundary.status = optimized.feasible ? 'optimal' : 'infeasible';
    if (optimized.feasible) { best = { ...optimized, candidates, threshold }; break; }
  }
  const elapsedMs = performance.now() - started;
  if (!best) return fail('v2-no-feasible', 'all-overlap-thresholds-proven-infeasible', {
    ...baseDebug, boundaryProof: proof, states: totalNodes, solverNodes: totalNodes,
    searchMs: Math.round(elapsedMs)
  }, true);
  const recovered = extractAndVerify(best, best.candidates, binary, input, meta, best.threshold);
  const overlaps = recovered.groups.map((group) => group.overlap).sort((a, b) => a - b);
  const templateUsageSum = recovered.groups.reduce((sum, group) => sum + group.templateUsage, 0);
  if (JSON.stringify(overlaps) !== JSON.stringify(best.vector) || templateUsageSum !== best.templateUsageSum) {
    throw new Error('V2 lexicographic optimum metrics did not match the recovered assignment');
  }
  const debug = {
    ...baseDebug, searchMode: 'V2', phase: 'complete', optimalityProven: true,
    boundaryProof: proof, thresholdCandidates: proof.find((item) => item.threshold === best.threshold)?.candidateTemplates || 0,
    minimumOverlap: best.threshold, overlap: overlaps, totalOverlap: best.totalOverlap,
    templateUsages: recovered.groups.map((group) => group.templateUsage), templateUsageSum,
    reqUsed: recovered.reqUsed, optUsed: recovered.optUsed, totalCards: recovered.totalCards,
    duplicateCards: recovered.duplicates, outsideSelectedPool: recovered.outsideCount,
    states: totalNodes, solverNodes: totalNodes, stages: best.stages,
    searchMs: Math.round(elapsedMs), elapsedMs: Math.round(elapsedMs),
    solverVersion: highs.version?.string || 'unknown', balancedOverlap: overlaps
  };
  return {
    type: 'result', mode: 'V2', ok: true, complete: true, optimalityProven: true,
    best: { items: recovered.groups.map((group) => ({
      cards: group.final, usage: null, wins: 0, losses: 0,
      overlap: group.overlap, templateUsage: group.templateUsage,
      templateWins: group.wins, templateLosses: group.losses,
      templateCards: group.template, templateIndex: group.templateIndex
    })), total: null, overlap: overlaps, templateUsageSum },
    relatedByGroup: [], debug: { ...debug, selectedEvoSlots: evoCountBySlot.filter(Boolean).length, selectedChampionHeroSlots: championHeroCountBySlot.filter(Boolean).length },
    groups: recovered.groups, minimumOverlap: best.threshold, totalOverlap: best.totalOverlap,
    overlapVector: overlaps, templateUsageSum
  };
}

export const V2_TEMPLATE_USAGE_FLOOR = TEMPLATE_USAGE_FLOOR;
