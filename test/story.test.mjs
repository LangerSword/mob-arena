import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, ENCOUNTERS, createState, starterBeast, xpFor, levelFromXp, applyXp, unlocked, route } from '../src/story.mjs';

test('three regions with escalating levels', () => {
  assert.equal(REGIONS.length, 3);
  assert.ok(REGIONS[0].level[0] < REGIONS[1].level[0]);
  assert.ok(REGIONS[1].level[0] < REGIONS[2].level[0]);
});

test('every encounter belongs to a real region', () => {
  for (const e of ENCOUNTERS) assert.ok(REGIONS.some((r) => r.id === e.region), e.id);
});

test('the route is ordered and has a boss at each region end', () => {
  const r = route();
  assert.equal(r.length, ENCOUNTERS.length);
  assert.equal(r.filter((e) => e.boss).length, 3);
});

test('bosses pay triple xp', () => {
  const boss = ENCOUNTERS.find((e) => e.boss);
  const normal = ENCOUNTERS.find((e) => !e.boss && e.level === boss.level - 18);
  assert.ok(xpFor(boss, true) > xpFor({ ...boss, boss: false }, true));
});

test('a loss pays a little xp, not zero', () => {
  assert.ok(xpFor(ENCOUNTERS[0], false) > 0);
  assert.ok(xpFor(ENCOUNTERS[0], false) < xpFor(ENCOUNTERS[0], true));
});

test('level from xp ramps: 100 for level 2, then 200, then 300', () => {
  assert.deepEqual(levelFromXp(0), { level: 1, into: 0, need: 100 });
  assert.deepEqual(levelFromXp(100), { level: 2, into: 0, need: 200 });
  assert.deepEqual(levelFromXp(300), { level: 3, into: 0, need: 300 });
  assert.equal(levelFromXp(299).level, 2);
});

test('applyXp adds the xp and reports level-ups', () => {
  const b = starterBeast(5);
  const after = applyXp(b, 250);
  assert.equal(after.xp, 250);
  assert.equal(after.level, 2);
  assert.equal(after.levelUps, 1);
  assert.ok(after.maxHealth > b.maxHealth);
});

test('a fresh state has the first encounter open and the rest locked', () => {
  const list = unlocked(createState());
  assert.equal(list[0].state, 'open');
  assert.equal(list[1].state, 'locked');
  assert.equal(list[8].state, 'locked');
});

test('clearing an encounter opens the next', () => {
  const state = createState();
  state.completed = ['e1', 'e2'];
  const list = unlocked(state);
  assert.equal(list[0].state, 'cleared');
  assert.equal(list[1].state, 'cleared');
  assert.equal(list[2].state, 'open');
  assert.equal(list[3].state, 'locked');
});

test('starter beast stats are self-consistent', () => {
  const b = starterBeast(10);
  assert.equal(b.power, Math.min(10 * (6 - b.tier), 65535));
  assert.equal(b.maxHealth, b.health);
});
