// MOB Arena game engine: pure functions, no DOM, no chain. Tests cover it directly.
// Rules: a Beast's stats come from its token ID (level, health, tier, type, power).
// A round is two hits, faster Beast (higher level) first. Type advantage multiplies.

export const BEAST_TYPES = ['Magic', 'Hunter', 'Brute'];
export const TYPE_BEATS = { Magic: 'Hunter', Hunter: 'Brute', Brute: 'Magic' };

export function typeMultiplier(attackerType, defenderType) {
  const at = BEAST_TYPES[attackerType];
  const dt = BEAST_TYPES[defenderType];
  if (TYPE_BEATS[at] === dt) return 1.5;
  if (TYPE_BEATS[dt] === at) return 0.75;
  return 1;
}

/** Damage per hit. Power is level * (6 - tier), capped at 65535. */
export function hitDamage(attacker, defender, powerFn) {
  const power = powerFn(attacker);
  const mult = typeMultiplier(attacker.beastType, defender.beastType);
  return Math.max(1, Math.round(power * 0.02 * mult));
}

/** One round: both strike, higher level first. If the first fells the second, it doesn't hit back. */
export function round(a, b, powerFn) {
  const [first, second] = a.level >= b.level ? [a, b] : [b, a];
  const secondAfter = Math.max(0, second.health - hitDamage(first, second, powerFn));
  const firstAfter = secondAfter > 0 ? Math.max(0, first.health - hitDamage(second, first, powerFn)) : first.health;
  const out = {};
  out[first === a ? 'a' : 'b'] = firstAfter;
  out[first === a ? 'b' : 'a'] = secondAfter;
  return { a: out.a, b: out.b, first: first === a ? 'a' : 'b' };
}

/** Full fight. Returns a round-by-round log and a winner. */
export function battle(a, b, powerFn) {
  const log = [];
  let healthA = a.health;
  let healthB = b.health;
  let turn = 'a';
  for (let i = 0; i < 500 && healthA > 0 && healthB > 0; i++) {
    const r = round({ ...a, health: healthA }, { ...b, health: healthB }, powerFn);
    healthA = r.a;
    healthB = r.b;
    log.push({ round: i + 1, first: r.first, a: healthA, b: healthB });
    turn = r.first;
  }
  const winner = healthA === healthB ? 'draw' : healthA > healthB ? 'a' : 'b';
  return { winner, rounds: log.length, log, lastTurn: turn };
}

/** The default power rule, matching the contracts: level * (6 - tier), capped. */
export const power = (beast) => Math.min(beast.level * (6 - beast.tier), 65535);

/** Turns a decoded token ID into a fighter. */
export function fighterFromBeast(beast) {
  return {
    tokenId: beast.tokenId ?? beast.token_id,
    speciesId: beast.speciesId,
    name: beast.name ?? `${BEAST_TYPES[beast.beastType]} ${beast.speciesId}`,
    level: beast.level,
    health: beast.health,
    maxHealth: beast.health,
    tier: beast.tier,
    beastType: beast.beastType,
    power: power(beast),
    rank: beast.rank,
    grade: beast.grade,
    prefix: beast.prefix,
    suffix: beast.suffix,
    visualEffects: beast.visualEffects,
  };
}
