// Checks token-id.mjs against the canonical vectors: node --test scripts/token-id.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decodeTokenId, encodeTokenId } from './token-id.mjs';

const vectors = JSON.parse(readFileSync(new URL('../assets/token-id-vectors.json', import.meta.url)));
const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const toBeast = (raw) => {
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'condition' && value && typeof value === 'object') {
      out.condition = Object.fromEntries(Object.entries(value).map(([k, v]) => [camel(k), v]));
    } else if (['species_id', 'minted_at_block_number', 'transfer_lock_hours'].includes(key) && typeof value === 'string') {
      out[camel(key)] = BigInt(value);
    } else {
      out[camel(key)] = value;
    }
  }
  return out;
};

for (const v of vectors.vectors) {
  test(`vector ${v.name}`, () => {
    const beast = toBeast(v.beast);
    assert.equal(encodeTokenId(beast), BigInt(v.tokenId));
    assert.deepEqual(decodeTokenId(v.tokenId), beast);
  });
}
for (const v of vectors.normalization) {
  test(`normalization ${v.name}`, () => assert.equal(encodeTokenId(toBeast(v.input)), BigInt(v.tokenId)));
}
for (const v of vectors.decodeRejections) {
  test(`decode rejects ${v.name}`, () => assert.throws(() => decodeTokenId(v.tokenId)));
}
for (const v of vectors.encodeRejections) {
  test(`encode rejects ${v.name}`, () => assert.throws(() => encodeTokenId(toBeast(v.input))));
}
