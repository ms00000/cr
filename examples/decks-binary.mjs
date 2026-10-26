const HEADER_SIZE = 36;
const RECORD_SIZE = 32;
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function encodeSyntheticDecks(cardKeys, templates) {
  if (!Array.isArray(cardKeys) || new Set(cardKeys).size !== cardKeys.length || cardKeys.length > 256) throw new Error('Expected unique card keys (maximum 256).');
  if (!Array.isArray(templates) || templates.some((deck) => deck.cards?.length !== 8)) throw new Error('Each template must contain exactly eight cards.');
  const index = new Map(cardKeys.map((key, i) => [key, i]));
  const records = new Uint8Array(templates.length * RECORD_SIZE);
  const recordView = new DataView(records.buffer);
  templates.forEach((deck, deckIndex) => {
    const offset = deckIndex * RECORD_SIZE;
    const indices = deck.cards.map((key) => index.get(key));
    if (indices.some((value) => value === undefined) || new Set(indices).size !== 8) throw new Error(`Template ${deckIndex} contains unknown or duplicate cards.`);
    indices.forEach((value, slot) => recordView.setUint8(offset + slot, value));
    for (const [field, value] of [['usage', deck.usage], ['wins', deck.wins], ['losses', deck.losses]]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer.`);
    }
    recordView.setBigUint64(offset + 8, BigInt(deck.usage), true);
    recordView.setBigUint64(offset + 16, BigInt(deck.wins), true);
    recordView.setBigUint64(offset + 24, BigInt(deck.losses), true);
  });
  const bytes = new Uint8Array(HEADER_SIZE + records.length);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('CRD2'), 0);
  view.setUint16(4, 1, true);
  view.setUint8(6, 1);
  view.setUint8(7, 8);
  view.setUint32(8, cardKeys.length, true);
  view.setUint32(12, templates.length, true);
  view.setUint32(16, RECORD_SIZE, true);
  view.setUint32(20, crc32(new TextEncoder().encode(cardKeys.join('\n'))), true);
  view.setUint32(24, crc32(records), true);
  bytes.set(records, HEADER_SIZE);
  view.setUint32(28, 0, true);
  view.setUint32(28, crc32(bytes.subarray(0, HEADER_SIZE)), true);
  return bytes.buffer;
}
