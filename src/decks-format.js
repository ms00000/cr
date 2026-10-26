/* Shared compact CRD2 parser. It creates TypedArrays, never deck objects. */
(function (root) {
  'use strict';
  const HEADER_SIZE = 36;
  const MAGIC = 'CRD2';

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function textCrc(keys) {
    return crc32(new TextEncoder().encode(keys.join('\n')));
  }

  function readCounter(view, offset) {
    if (typeof view.getBigUint64 === 'function') return Number(view.getBigUint64(offset, true));
    return view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 4294967296;
  }

  function parse(buffer, cardKeys) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_SIZE) throw new Error('Invalid decks.bin buffer');
    const view = new DataView(buffer);
    let magic = '';
    for (let i = 0; i < 4; i += 1) magic += String.fromCharCode(view.getUint8(i));
    const version = view.getUint16(4, true);
    const indexWidth = view.getUint8(6);
    const counterWidth = view.getUint8(7);
    const cardCount = view.getUint32(8, true);
    const deckCount = view.getUint32(12, true);
    const recordSize = view.getUint32(16, true);
    const cardsCrc = view.getUint32(20, true);
    const recordsCrc = view.getUint32(24, true);
    const headerCrc = view.getUint32(28, true);
    if (magic !== MAGIC || version !== 1 || ![1, 2, 4].includes(indexWidth) || counterWidth !== 8) throw new Error('Invalid decks.bin header');
    const expectedRecordSize = indexWidth * 8 + 24;
    if (recordSize !== expectedRecordSize || buffer.byteLength !== HEADER_SIZE + deckCount * recordSize) throw new Error('Invalid decks.bin record layout');
    const headerCopy = new Uint8Array(buffer.slice(0, HEADER_SIZE));
    new DataView(headerCopy.buffer).setUint32(28, 0, true);
    if (crc32(headerCopy) !== headerCrc) throw new Error('decks.bin header checksum mismatch');
    if (!Array.isArray(cardKeys) || cardKeys.length !== cardCount || textCrc(cardKeys.map(String)) !== cardsCrc) throw new Error('decks.bin does not match cards.json');
    const records = new Uint8Array(buffer, HEADER_SIZE);
    if (crc32(records) !== recordsCrc) throw new Error('decks.bin records checksum mismatch');
    const deckCards = indexWidth === 1 ? new Uint8Array(deckCount * 8) : indexWidth === 2 ? new Uint16Array(deckCount * 8) : new Uint32Array(deckCount * 8);
    const usages = new Float64Array(deckCount);
    const wins = new Float64Array(deckCount);
    const losses = new Float64Array(deckCount);
    const offset = indexWidth * 8;
    for (let deck = 0; deck < deckCount; deck += 1) {
      const base = HEADER_SIZE + deck * recordSize;
      for (let slot = 0; slot < 8; slot += 1) deckCards[deck * 8 + slot] = indexWidth === 1 ? view.getUint8(base + slot) : indexWidth === 2 ? view.getUint16(base + slot * 2, true) : view.getUint32(base + slot * 4, true);
      usages[deck] = readCounter(view, base + offset);
      wins[deck] = readCounter(view, base + offset + 8);
      losses[deck] = readCounter(view, base + offset + 16);
    }
    return { cardCount, deckCount, indexWidth, recordSize, cardsCrc, recordsCrc, deckCards, usages, wins, losses };
  }

  root.CRDDecks = { HEADER_SIZE, MAGIC, crc32, parse };
}(typeof self !== 'undefined' ? self : window));
