import test from 'node:test'; import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises'; import {dirname,join} from 'node:path'; import {fileURLToPath,pathToFileURL} from 'node:url';
import {encodeSyntheticDecks} from '../examples/decks-binary.mjs';
const here=dirname(fileURLToPath(import.meta.url)); const root=dirname(here); const fixture=JSON.parse(await readFile(join(root,'examples','deck-templates.json'),'utf8'));
const cardKeys=[...new Set([...fixture.required,...fixture.optional,...fixture.templates.flatMap(t=>t.cards)])];
const cardMeta=cardKeys.map(key=>{const variant=key.split(':').at(-1);return {variant,rarity:['REQ-00:base','REQ-02:base'].includes(key)||variant==='hero'?'champion':'common'};});
const makeInput=()=>({required:[...fixture.required],optional:[...fixture.optional],excluded:[],cardKeys:[...cardKeys],cardMeta:[...cardMeta],dataVersion:fixture.dataVersion,binary:encodeSyntheticDecks(cardKeys,fixture.templates)});
globalThis.self=globalThis; await import('../src/decks-format.js'); const {runV2Search}=await import('../src/expert-search-core-v2.mjs');
const highs=await (await import('../src/vendor/highs.mjs')).default({locateFile:file=>pathToFileURL(join(root,'src','vendor',file)).href});
test('exactly allocates four unique decks and proves the synthetic optimum',async()=>{
 const r=await runV2Search(makeInput(),highs); assert.equal(r.ok,true); assert.equal(r.optimalityProven,true); assert.equal(r.debug.reqUsed,20); assert.equal(r.debug.optUsed,12); assert.equal(r.debug.totalCards,32); assert.equal(r.debug.duplicateCards,0); assert.equal(r.debug.outsideSelectedPool,0); assert.deepEqual(r.overlapVector,[7,7,7,7]);
 const flat=r.groups.flatMap(g=>g.final); assert.equal(flat.length,32); assert.equal(new Set(flat).size,32); assert.ok(fixture.required.every(k=>flat.includes(k))); assert.ok(flat.every(k=>fixture.required.includes(k)||fixture.optional.includes(k)));
 for(const g of r.groups){assert.equal(g.final.length,8);const meta=new Map(cardKeys.map((k,i)=>[k,cardMeta[i]]));assert.ok(g.final.filter(k=>meta.get(k).variant==='ev1').length<=2);assert.equal(g.final.filter(k=>meta.get(k).variant==='hero'||meta.get(k).rarity==='champion').length,1);}
});
test('rejects duplicate and overlapping selections',async()=>{const d=makeInput();d.optional.push(d.required[0]);const r=await runV2Search(d,highs);assert.equal(r.ok,false);assert.equal(r.reason,'v2-invalid-selection');});
test('rejects a selected pool smaller than 32',async()=>{const d=makeInput();d.optional=d.optional.slice(0,11);const r=await runV2Search(d,highs);assert.equal(r.ok,false);assert.equal(r.reason,'v2-pool-short');});
test('rejects more required cards than four decks can hold',async()=>{const d=makeInput();d.required=[...d.required,...d.optional.slice(0,13)];d.optional=d.optional.slice(13);const r=await runV2Search(d,highs);assert.equal(r.ok,false);assert.equal(r.reason,'v2-req-overflow');});
test('CRD2 parser detects a corrupted record checksum',()=>{const d=makeInput();const b=d.binary.slice(0);new Uint8Array(b)[b.byteLength-1]^=1;assert.throws(()=>globalThis.CRDDecks.parse(b,d.cardKeys),/checksum mismatch/);});
test('proves infeasibility when four Champion/Hero slots cannot be filled',async()=>{const d=makeInput();d.cardMeta[d.cardKeys.indexOf('REQ-03:hero')]={variant:'base',rarity:'common'};const r=await runV2Search(d,highs);assert.equal(r.ok,false);assert.equal(r.reason,'v2-no-feasible');assert.equal(r.optimalityProven,true);});