import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, hitDamage, power, round, typeMultiplier, fighterFromBeast } from '../src/engine.mjs';

const beast = (over = {}) => ({
  tokenId: '1', speciesId: 1, level: 5, health: 100, maxHealth: 100, tier: 3, beastType: 1, rank: 0, grade: 10, ...over,
});

test('power is level * (6 - tier), capped', () => {
  assert.equal(power(beast({ level: 5, tier: 3 })), 15);
  assert.equal(power(beast({ level: 5, tier: 1 })), 25);
  assert.equal(power(beast({ level: 65535, tier: 1 })), 65535);
});

test('type advantage and disadvantage', () => {
  assert.equal(typeMultiplier(0, 1), 1.5);  // Magic beats Hunter
  assert.equal(typeMultiplier(1, 0), 0.75); // Hunter loses to Magic
  assert.equal(typeMultiplier(0, 0), 1);
  assert.equal(typeMultiplier(2, 0), 1.5);  // Brute beats Magic
});

test('damage scales with power and multiplier', () => {
  const a = beast({ level: 5, tier: 3 });   // power 15
  const b = beast({ level: 5, tier: 3 });
  assert.equal(hitDamage(a, b, power), Math.max(1, Math.round(15 * 0.02 * 1)));
  assert.equal(hitDamage({ ...a, beastType: 0 }, { ...b, beastType: 1 }, power), Math.max(1, Math.round(15 * 0.02 * 1.5)));
});

test('higher level strikes first', () => {
  const a = beast({ level: 9, health: 100 });
  const b = beast({ level: 4, health: 100 });
  const r = round(a, b, power);
  assert.equal(r.first, 'a');
});

test('a felled Beast does not hit back', () => {
  const a = beast({ level: 50, health: 100 });
  const b = beast({ level: 1, health: 1 });
  const r = round(a, b, power);
  assert.equal(r.b, 0);
  assert.equal(r.a, 100); // untouched
});

test('a fight ends with a winner and a bounded log', () => {
  const a = beast({ level: 5, tier: 3, health: 100, beastType: 0 });
  const b = beast({ level: 5, tier: 3, health: 100, beastType: 1 });
  const out = battle(a, b, power);
  assert.ok(['a', 'b', 'draw'].includes(out.winner));
  assert.ok(out.log.length <= 500);
  const last = out.log[out.log.length - 1];
  assert.ok(last.a === 0 || last.b === 0 || out.log.length === 500);
});

test('higher level wins a mirror match', () => {
  const a = beast({ level: 8, health: 100 });
  const b = beast({ level: 2, health: 100 });
  assert.equal(battle(a, b, power).winner, 'a');
});

test('a mirror match with equal stats is decided by the first-strike rule, not a draw', () => {
  const a = beast({ level: 5, health: 100 });
  const b = beast({ level: 5, health: 100 });
  const out = battle(a, b, power);
  assert.notEqual(out.winner, 'draw');
});

test('fighterFromBeast carries the fields the UI needs', () => {
  const f = fighterFromBeast({ tokenId: '0x1', speciesId: 2, level: 7, health: 88, tier: 2, beastType: 2, rank: 1, grade: 8 });
  assert.equal(f.power, 28);
  assert.equal(f.name, 'Brute 2');
  assert.equal(f.maxHealth, 88);
});
