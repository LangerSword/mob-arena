// MOB Arena story mode: a region, a route of encounters, XP and levels.
// Pure data + pure functions, no DOM, no chain. The page drives it.

/** A region is a named biome with a palette and a species pool. */
export const REGIONS = [
  {
    id: 'emberfall', name: 'Emberfall', tagline: 'Ash plains under a red moon',
    palette: ['#2a1410', '#c8a24a', '#ff8a6b'], species: [1, 2, 3], level: [1, 20],
    blurb: 'The first route. Beasts here are young and slow to strike.',
  },
  {
    id: 'glassveil', name: 'Glassveil', tagline: 'A forest of frozen sound',
    palette: ['#0d1a1a', '#63d6a4', '#7aa2ff'], species: [4, 5, 6, 7], level: [20, 60],
    blurb: 'Named Songs echo between the trees. Stronger, and they hit first.',
  },
  {
    id: 'hollowdeep', name: 'Hollowdeep', tagline: 'Where the chain folds in on itself',
    palette: ['#120d1a', '#b98aff', '#ff6b9d'], species: [8, 9, 10, 11, 12], level: [60, 100],
    blurb: 'The last route. Full-level Beasts, and no mercy in the turn order.',
  },
];

/** One encounter on the route. */
export const ENCOUNTERS = [
  { id: 'e1', region: 'emberfall', name: 'First Light', species: 1, prefix: 63, suffix: 4, level: 5, health: 60, tier: 3, beastType: 0 },
  { id: 'e2', region: 'emberfall', name: 'Ash Whisper', species: 2, prefix: 1, suffix: 1, level: 12, health: 80, tier: 3, beastType: 1 },
  { id: 'e3', region: 'emberfall', name: 'The Gatekeeper', species: 3, prefix: 2, suffix: 2, level: 20, health: 120, tier: 2, beastType: 2, boss: true },

  { id: 'e4', region: 'glassveil', name: 'Choir of Frost', species: 4, prefix: 3, suffix: 3, level: 28, health: 140, tier: 2, beastType: 0 },
  { id: 'e5', region: 'glassveil', name: 'Silent Verse', species: 5, prefix: 4, suffix: 4, level: 38, health: 160, tier: 2, beastType: 1 },
  { id: 'e6', region: 'glassveil', name: 'The Conductor', species: 6, prefix: 5, suffix: 5, level: 50, health: 220, tier: 1, beastType: 2, boss: true },

  { id: 'e7', region: 'hollowdeep', name: 'Static Between Stars', species: 7, prefix: 6, suffix: 6, level: 62, health: 240, tier: 1, beastType: 0 },
  { id: 'e8', region: 'hollowdeep', name: 'The Last Refrain', species: 8, prefix: 7, suffix: 7, level: 78, health: 300, tier: 1, beastType: 1 },
  { id: 'e9', region: 'hollowdeep', name: 'MOB Prime', species: 9, prefix: 8, suffix: 8, level: 100, health: 400, tier: 1, beastType: 2, boss: true },
];

export const XP_BASE = 40;

/** XP for a win. Bosses pay triple. */
export function xpFor(encounter, won) {
  if (!won) return Math.round(XP_BASE * 0.15);
  return XP_BASE * (encounter.boss ? 3 : 1) * Math.max(1, Math.round(encounter.level / 10));
}

/** Level from total XP: each level needs 100 * level XP, so it ramps. */
export function levelFromXp(xp) {
  let level = 1;
  let need = 100;
  while (xp >= need && level < 100) {
    xp -= need;
    level++;
    need = 100 * level;
  }
  return { level, into: xp, need };
}

/** A trainer's starter Beast, scaled to the region's entry level. */
export function starterBeast(level = 5) {
  return {
    name: 'Ember', speciesId: 1, level, health: 60 + level * 4, maxHealth: 60 + level * 4,
    tier: 3, beastType: 0, prefix: 63, suffix: 4, power: Math.min(level * (6 - 3), 65535), xp: 0,
  };
}

/** Applies XP and returns the new state plus any level-ups. */
export function applyXp(beast, amount) {
  const before = levelFromXp(beast.xp).level;
  const xp = beast.xp + amount;
  const after = levelFromXp(xp);
  const gained = after.level - before;
  const healthGain = gained * 6;
  return {
    ...beast,
    xp,
    level: after.level,
    health: beast.health + healthGain,
    maxHealth: beast.maxHealth + healthGain,
    power: Math.min(after.level * (6 - beast.tier), 65535),
    levelUps: gained,
  };
}

/** The route as a list of encounters with their region, for rendering. */
export function route() {
  return ENCOUNTERS.map((e) => {
    const region = REGIONS.find((r) => r.id === e.region);
    return { ...e, regionName: region?.name, palette: region?.palette };
  });
}

/** Which encounters are unlocked: everything before the first unbeaten one, plus it. */
export function unlocked(state) {
  const done = new Set(state.completed ?? []);
  const list = route();
  const next = list.find((e) => !done.has(e.id));
  return list.map((e, i) => ({
    ...e,
    state: done.has(e.id) ? 'cleared' : e === next ? 'open' : 'locked',
    index: i,
  }));
}

export function createState() {
  return { trainer: 'Rookie', beast: starterBeast(), completed: [], wins: 0, losses: 0, region: 'emberfall' };
}
