import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTokenId, decodeByteArray, shortString, toU256 } from '../src/chain.mjs';

// The Warlock Genesis ID from the live chain (species 1), read 2026-11-05.
const WARLOCK = '0x90000200c80000001c8307d010d2156000000000003180000000000';

test('decodes the live Warlock Genesis ID', () => {
  const b = decodeTokenId(WARLOCK);
  assert.equal(b.speciesId, 1);
  assert.equal(b.tier, 1);
  assert.equal(b.beastType, 0); // Magic
  assert.equal(b.level, 1);
  assert.equal(b.health, 100);
  assert.equal(b.prefix, 0);
  assert.equal(b.suffix, 0);
  assert.equal(b.visualEffects, 3);
  assert.equal(b.centeringXBps, 10000);
});

test('rejects a token ID with bits above 250', () => {
  assert.throws(() => decodeTokenId(1n << 251n), /above bit 250/);
});

test('rejects a half-Genesis affix pair', () => {
  // species 1, prefix 0, suffix 1
  const id = (1n << 219n) | (1n << 216n) | (0n << 174n) | (1n << 169n);
  assert.throws(() => decodeTokenId(id), /affix combo/);
});

test('decodes a ByteArray: length, words, pending word, pending length', () => {
  // "hi" as a Cairo ByteArray: 0 full words, pending word 0x6869, pending len 2
  const felts = [0n, 0x6869n, 2n];
  assert.equal(decodeByteArray(felts), 'hi');
});

test('decodes a ByteArray with a full 31-byte word', () => {
  const text = 'a'.repeat(31) + 'b';
  const bytes = Buffer.from(text, 'utf8');
  const felts = [1n, BigInt('0x' + bytes.subarray(0, 31).toString('hex')), BigInt('0x' + bytes.subarray(31).toString('hex')), 1n];
  assert.equal(decodeByteArray(felts), text);
});

test('shortString decodes a species name', () => {
  assert.equal(shortString(BigInt('0x' + Buffer.from('Warlock', 'utf8').toString('hex'))), 'Warlock');
});

test('u256 splits into low and high', () => {
  const [low, high] = toU256(WARLOCK);
  assert.equal(BigInt(low) + (BigInt(high) << 128n), BigInt(WARLOCK));
});
