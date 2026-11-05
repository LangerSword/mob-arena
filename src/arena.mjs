// MOB Arena core: reads and writes only. No framework, no DOM.
// A token ID is the whole Beast: every immutable stat lives in its 251 bits.
// Fetch the chain through the skill's read helper; keep IDs as bigint/strings.

import { addSharedTrackCall, mintCall, registerWithArtCall, selectNamedSongCall } from '../scripts/species-calls.mjs';
import { ADDRESSES, call } from '../scripts/beasts-read.mjs';
import { beastPower, decodeTokenId, tokenIdToU256 } from '../scripts/token-id.mjs';

export { ADDRESSES, beastPower, decodeTokenId, tokenIdToU256 };

/** Condition roll: perfect centering, no wear. The contract stamps block and minute. */
export const PERFECT = { centeringXBps: 10000, centeringXDirection: 0, centeringYBps: 10000, centeringYDirection: 0,
  hickeyCount: 0, hickeysInArt: 0, voidLevel: 0, voidsInArt: 0, rollerLevel: 0, rollersInArt: 0,
  edgeChipLevel: 0, cornerChipLevel: 0 };

/** Reads a live Beast: decoded ID plus owner, rank and grade from the chain. */
export async function getBeast(url, network, tokenId) {
  const { nft } = ADDRESSES[network];
  const beast = decodeTokenId(tokenId);
  const [owner, grade, rank] = await Promise.all([
    call(url, nft, 'owner_of', tokenIdToU256(tokenId)).then((r) => r[0]),
    call(url, nft, 'get_card_grade', [tokenId]).then((r) => r[0]),
    call(url, nft, 'get_beast_rank', [tokenId]).then((r) => r[0]),
  ]);
  return { ...beast, power: beastPower(beast), owner, grade: Number(grade), rank: Number(rank) };
}

/** Is this identity still free? Zero means unminted. */
export async function isMinted(url, network, speciesId, prefix, suffix) {
  const { nft } = ADDRESSES[network];
  return call(url, nft, 'get_token_id_by_affixes', [speciesId, prefix, suffix]).then((r) => BigInt(r[0]) !== 0n);
}

export function registerSpeciesCall({ network, name, beastType, tier, minter, speciesOwner, art, soundManager, description = '', royaltyBps = 0 }) {
  return registerWithArtCall({
    registry: ADDRESSES[network].registry, name, beastType, tier, minter, speciesOwner, art,
    soundManager: soundManager ?? '0x0', description, royaltyBps,
  });
}

export function mintBeastCall({ network, to, speciesId, prefix, suffix, level, health, effects = 0, condition = PERFECT }) {
  return mintCall({ nft: ADDRESSES[network].nft, to, speciesId, prefix, suffix, level, health, effects, condition });
}

export function addTrackCall({ network, speciesId, inputs }) {
  return addSharedTrackCall({ manager: ADDRESSES[network].soundManager, speciesId, inputs });
}

export function namedSongCall({ tokenId }) {
  return selectNamedSongCall({ manager: ADDRESSES.sepolia.soundManager, tokenId });
}

/** Battle rules. Pure functions, so the UI and the CLI agree and tests cover them without a chain. */
export const TYPE_ADVANTAGE = { Magic: 'Hunter', Hunter: 'Brute', Brute: 'Magic' };

export function typeMultiplier(attackerType, defenderType) {
  return TYPE_ADVANTAGE[attackerType] === defenderType ? 1.5 : TYPE_ADVANTAGE[defenderType] === attackerType ? 0.75 : 1;
}

/** One round: both Beasts hit once, faster Beast (higher level) first. No RNG, so it is reproducible. */
export function battleRound(a, b) {
  const order = a.level >= b.level ? [a, b] : [b, a];
  const [first, second] = order;
  const apply = (attacker, defender) => {
    const mult = typeMultiplier(BEAST_TYPES[attacker.beastType], BEAST_TYPES[defender.beastType]);
    const damage = Math.max(1, Math.round(attacker.power * 0.02 * mult));
    return { ...defender, health: Math.max(0, defender.health - damage) };
  };
  let afterFirst = apply(first, second);
  let afterSecond = afterFirst.health > 0 ? apply(second, first) : first;
  const out = {};
  out[order[0] === a ? 'a' : 'b'] = afterSecond;
  out[order[0] === a ? 'b' : 'a'] = afterFirst;
  return out;
}

export const BEAST_TYPES = ['Magic', 'Hunter', 'Brute'];

/** Full fight to zero health. Returns a log and a winner key. */
export function battle(a, b) {
  const log = [];
  let healthA = a.health;
  let healthB = b.health;
  let round = 0;
  while (healthA > 0 && healthB > 0 && round < 500) {
    const state = { a: { ...a, health: healthA }, b: { ...b, health: healthB } };
    const result = battleRound(state.a, state.b);
    healthA = result.a.health;
    healthB = result.b.health;
    log.push({ round: ++round, aHealth: healthA, bHealth: healthB });
  }
  return { winner: healthA > healthB ? 'a' : healthB > healthA ? 'b' : 'draw', rounds: round, log };
}
