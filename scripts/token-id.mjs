#!/usr/bin/env node
// Beasts token-ID codec, schema beasts-v3-species-first-251-v2. Zero dependencies.
//
// The token ID is the Beast: every immutable field lives in these 251 bits.
//   node token-id.mjs decode 0x9000...
//   import { decodeTokenId, encodeTokenId, tokenIdToU256 } from './token-id.mjs'
//
// encodeTokenId is for tests and tooling. A real ID carries the block and
// minute of its mint, so read live IDs from the chain instead of deriving them.

import { pathToFileURL } from 'node:url';

export const TOKEN_ID_SCHEMA = 'beasts-v3-species-first-251-v2';
export const SPECIES_SHIFT = 219n;
export const MAX_SUPPLY_PER_SPECIES = 69 * 18 + 1;
export const MAX_SPECIES_ID = (1n << 32n) - 1n;
export const MAX_PRESET = 31;
export const MAX_TRANSFER_DAMAGE_CHANCE = 2047;
export const MAX_TRANSFER_LOCK_HOURS = 16382n;
export const TRANSFER_LOCK_FOREVER = (1n << 64n) - 1n;
export const MAX_MINTED_AT_BLOCK_NUMBER = (1n << 32n) - 1n;
export const MAX_MINTED_AT_MINUTE = (1 << 27) - 1;
export const MAX_MINTER_DATA = 0xffffffff;
export const BEAST_TYPES = ['Magic', 'Hunter', 'Brute'];

const PERFECT_BPS = 10000;
const LOCK_FIELD_FOREVER = (1n << 14n) - 1n;
const U128 = (1n << 128n) - 1n;
const mask = (bits) => (1n << bits) - 1n;

export class TokenIdError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TokenIdError';
  }
}

const parse = (tokenId) => {
  if (typeof tokenId === 'bigint') {
    if (tokenId < 0n) throw new TokenIdError('tokenId must be non-negative');
    return tokenId;
  }
  if (typeof tokenId === 'string' && /^(0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(tokenId)) return BigInt(tokenId);
  // A JS number above 2^53 has already lost bits, and every real ID is above 2^219.
  throw new TokenIdError('tokenId must be a bigint, or a decimal or 0x-hex string');
};

const normalized = (c) => ({
  centeringXBps: c.centeringXBps,
  centeringXDirection: c.centeringXBps === PERFECT_BPS ? 0 : c.centeringXDirection,
  centeringYBps: c.centeringYBps,
  centeringYDirection: c.centeringYBps === PERFECT_BPS ? 0 : c.centeringYDirection,
  hickeyCount: c.hickeyCount,
  hickeysInArt: c.hickeyCount === 0 ? 0 : c.hickeysInArt,
  voidLevel: c.voidLevel,
  voidsInArt: c.voidLevel === 0 ? 0 : c.voidsInArt,
  rollerLevel: c.rollerLevel,
  rollersInArt: c.rollerLevel === 0 ? 0 : c.rollersInArt,
  edgeChipLevel: c.edgeChipLevel,
  cornerChipLevel: c.cornerChipLevel,
});

const assertAffixes = (prefix, suffix) => {
  if ((prefix === 0) !== (suffix === 0)) {
    throw new TokenIdError('invalid affix combo: prefix and suffix must both be zero (Genesis) or both nonzero');
  }
};

/** Decodes and validates a token ID exactly as the contract's decoder does. */
export function decodeTokenId(tokenId) {
  const packed = parse(tokenId);
  if (packed >> 251n) throw new TokenIdError('tokenId has nonzero bits above bit 250');
  const low = packed & U128;
  const high = packed >> 128n;
  const word = low & mask(64n);

  const speciesId = high >> 91n;
  if (speciesId === 0n) throw new TokenIdError('speciesId must not be zero');
  const group = high >> 53n;
  const health = Number(group & mask(16n));
  const level = Number((group >> 16n) & mask(16n));
  const beastType = Number((group >> 32n) & mask(3n));
  const tier = Number((group >> 35n) & mask(3n));
  const prefix = Number((high >> 46n) & mask(7n));
  const suffix = Number((high >> 41n) & mask(5n));
  if (tier < 1 || tier > 5) throw new TokenIdError(`tier out of range: ${tier}`);
  if (beastType > 2) throw new TokenIdError(`beastType out of range: ${beastType}`);
  if (prefix > 69) throw new TokenIdError(`prefix out of range: ${prefix}`);
  if (suffix > 18) throw new TokenIdError(`suffix out of range: ${suffix}`);
  assertAffixes(prefix, suffix);

  const read = (shift, bits) => Number((word >> shift) & mask(bits));
  const xError = read(0n, 14n);
  const yError = read(15n, 14n);
  if (xError > PERFECT_BPS) throw new TokenIdError(`centering x error ${xError} exceeds 10000`);
  if (yError > PERFECT_BPS) throw new TokenIdError(`centering y error ${yError} exceeds 10000`);
  const condition = {
    centeringXBps: PERFECT_BPS - xError,
    centeringXDirection: read(14n, 1n),
    centeringYBps: PERFECT_BPS - yError,
    centeringYDirection: read(29n, 1n),
    hickeyCount: read(30n, 2n),
    hickeysInArt: read(32n, 1n),
    voidLevel: read(33n, 2n),
    voidsInArt: read(35n, 1n),
    rollerLevel: read(36n, 2n),
    rollersInArt: read(38n, 1n),
    edgeChipLevel: read(39n, 2n),
    cornerChipLevel: read(41n, 2n),
  };
  const canonical = normalized(condition);
  for (const key of Object.keys(canonical)) {
    if (canonical[key] !== condition[key]) throw new TokenIdError(`noncanonical condition: ${key}`);
  }
  const lockField = (high >> 27n) & mask(14n);
  return {
    speciesId,
    prefix,
    suffix,
    level,
    health,
    visualEffects: Number((word >> 48n) & mask(5n)),
    soundEffects: Number((word >> 43n) & mask(5n)),
    tier,
    beastType,
    mintedAtBlockNumber: low >> 96n,
    transferDamageChance: Number(word >> 53n),
    transferLockHours: lockField === LOCK_FIELD_FOREVER ? TRANSFER_LOCK_FOREVER : lockField,
    mintedAtMinute: Number(high & mask(27n)),
    minterData: Number((low >> 64n) & mask(32n)),
    condition,
  };
}

const int = (name, value, min, max) => {
  if (!Number.isSafeInteger(value)) throw new TokenIdError(`${name} must be an integer`);
  if (value < min || value > max) throw new TokenIdError(`${name} out of range: ${value} (${min}-${max})`);
};
const big = (name, value, min, max) => {
  if (typeof value !== 'bigint') throw new TokenIdError(`${name} must be a bigint`);
  if (value < min || value > max) throw new TokenIdError(`${name} out of range: ${value} (${min}-${max})`);
};

/** Encodes a Beast with the contract's ranges, normalizing unused condition flags. */
export function encodeTokenId(b) {
  if (b === null || typeof b !== 'object') throw new TokenIdError('beast must be an object');
  big('speciesId', b.speciesId, 1n, MAX_SPECIES_ID);
  int('tier', b.tier, 1, 5);
  int('beastType', b.beastType, 0, 2);
  int('prefix', b.prefix, 0, 69);
  int('suffix', b.suffix, 0, 18);
  assertAffixes(b.prefix, b.suffix);
  int('level', b.level, 0, 65535);
  int('health', b.health, 0, 65535);
  int('visualEffects', b.visualEffects, 0, MAX_PRESET);
  int('soundEffects', b.soundEffects, 0, MAX_PRESET);
  big('mintedAtBlockNumber', b.mintedAtBlockNumber, 0n, MAX_MINTED_AT_BLOCK_NUMBER);
  int('transferDamageChance', b.transferDamageChance, 0, MAX_TRANSFER_DAMAGE_CHANCE);
  if (typeof b.transferLockHours !== 'bigint') throw new TokenIdError('transferLockHours must be a bigint');
  if (b.transferLockHours < 0n || (b.transferLockHours > MAX_TRANSFER_LOCK_HOURS && b.transferLockHours !== TRANSFER_LOCK_FOREVER)) {
    throw new TokenIdError(`transferLockHours out of range: ${b.transferLockHours}`);
  }
  int('mintedAtMinute', b.mintedAtMinute, 0, MAX_MINTED_AT_MINUTE);
  int('minterData', b.minterData, 0, MAX_MINTER_DATA);
  const r = b.condition;
  if (r === null || typeof r !== 'object') throw new TokenIdError('condition must be an object');
  int('condition.centeringXBps', r.centeringXBps, 0, PERFECT_BPS);
  int('condition.centeringXDirection', r.centeringXDirection, 0, 1);
  int('condition.centeringYBps', r.centeringYBps, 0, PERFECT_BPS);
  int('condition.centeringYDirection', r.centeringYDirection, 0, 1);
  for (const key of ['hickeyCount', 'voidLevel', 'rollerLevel', 'edgeChipLevel', 'cornerChipLevel']) int(`condition.${key}`, r[key], 0, 3);
  for (const key of ['hickeysInArt', 'voidsInArt', 'rollersInArt']) int(`condition.${key}`, r[key], 0, 1);

  const c = normalized(r);
  const word =
    BigInt(PERFECT_BPS - c.centeringXBps) |
    (BigInt(c.centeringXDirection) << 14n) |
    (BigInt(PERFECT_BPS - c.centeringYBps) << 15n) |
    (BigInt(c.centeringYDirection) << 29n) |
    (BigInt(c.hickeyCount) << 30n) |
    (BigInt(c.hickeysInArt) << 32n) |
    (BigInt(c.voidLevel) << 33n) |
    (BigInt(c.voidsInArt) << 35n) |
    (BigInt(c.rollerLevel) << 36n) |
    (BigInt(c.rollersInArt) << 38n) |
    (BigInt(c.edgeChipLevel) << 39n) |
    (BigInt(c.cornerChipLevel) << 41n) |
    (BigInt(b.soundEffects) << 43n) |
    (BigInt(b.visualEffects) << 48n) |
    (BigInt(b.transferDamageChance) << 53n);
  const low = (b.mintedAtBlockNumber << 96n) | (BigInt(b.minterData) << 64n) | word;
  const lockField = b.transferLockHours === TRANSFER_LOCK_FOREVER ? LOCK_FIELD_FOREVER : b.transferLockHours;
  const group = BigInt(b.health) | (BigInt(b.level) << 16n) | (BigInt(b.beastType) << 32n) | (BigInt(b.tier) << 35n);
  const high =
    (b.speciesId << 91n) |
    (group << 53n) |
    (BigInt(b.prefix) << 46n) |
    (BigInt(b.suffix) << 41n) |
    (lockField << 27n) |
    BigInt(b.mintedAtMinute);
  return (high << 128n) | low;
}

export const isGenesis = (beast) => beast.prefix === 0 && beast.suffix === 0;
/** Calldata for ERC-721, ERC-2981 and ERC-4906 entry points: [low, high]. */
export const tokenIdToU256 = (id) => ['0x' + (BigInt(id) & U128).toString(16), '0x' + (BigInt(id) >> 128n).toString(16)];
/** Calldata for every Beasts-defined entry point: one felt. */
export const tokenIdToFelt = (id) => '0x' + BigInt(id).toString(16);
/** Combat power, as the contract computes it. */
export const beastPower = (beast) => Math.min(beast.level * (6 - beast.tier), 65535);
/** Unix second a lock ends: 0n unlocked, TRANSFER_LOCK_FOREVER when locked forever. */
export const transferLockedUntil = (beast) =>
  beast.transferLockHours === TRANSFER_LOCK_FOREVER
    ? TRANSFER_LOCK_FOREVER
    : beast.transferLockHours === 0n
      ? 0n
      : BigInt(beast.mintedAtMinute) * 60n + beast.transferLockHours * 3600n;

export const SPECIES_NAMES = [
  'Warlock', 'Typhon', 'Jiangshi', 'Anansi', 'Basilisk', 'Gorgon', 'Kitsune', 'Lich', 'Chimera', 'Wendigo',
  'Rakshasa', 'Werewolf', 'Banshee', 'Draugr', 'Vampire', 'Goblin', 'Ghoul', 'Wraith', 'Sprite', 'Kappa',
  'Fairy', 'Leprechaun', 'Kelpie', 'Pixie', 'Gnome', 'Griffin', 'Manticore', 'Phoenix', 'Dragon', 'Minotaur',
  'Qilin', 'Ammit', 'Nue', 'Skinwalker', 'Chupacabra', 'Weretiger', 'Wyvern', 'Roc', 'Harpy', 'Pegasus',
  'Hippogriff', 'Fenrir', 'Jaguar', 'Satori', 'Direwolf', 'Bear', 'Wolf', 'Mantis', 'Spider', 'Rat',
  'Kraken', 'Colossus', 'Asag', 'Leviathan', 'Tarrasque', 'Titan', 'Nephilim', 'Behemoth', 'Hydra', 'Juggernaut',
  'Oni', 'Jotunn', 'Ettin', 'Cyclops', 'Giant', 'Nemean Lion', 'Berserker', 'Yeti', 'Golem', 'Metsavana',
  'Troll', 'Bigfoot', 'Ogre', 'Orc', 'Skeleton',
];
export const PREFIX_NAMES = [
  'Agony', 'Apocalypse', 'Armageddon', 'Beast', 'Behemoth', 'Blight', 'Blood', 'Bramble', 'Brimstone', 'Brood',
  'Carrion', 'Cataclysm', 'Chimeric', 'Corpse', 'Corruption', 'Damnation', 'Death', 'Demon', 'Dire', 'Dragon',
  'Dread', 'Doom', 'Dusk', 'Eagle', 'Empyrean', 'Fate', 'Foe', 'Gale', 'Ghoul', 'Gloom',
  'Glyph', 'Golem', 'Grim', 'Hate', 'Havoc', 'Honour', 'Horror', 'Hypnotic', 'Kraken', 'Loath',
  'Maelstrom', 'Mind', 'Miracle', 'Morbid', 'Oblivion', 'Onslaught', 'Pain', 'Pandemonium', 'Phoenix', 'Plague',
  'Rage', 'Rapture', 'Rune', 'Skull', 'Sol', 'Soul', 'Sorrow', 'Spirit', 'Storm', 'Tempest',
  'Torment', 'Vengeance', 'Victory', 'Viper', 'Vortex', 'Woe', 'Wrath', 'Lights', 'Shimmering',
];
export const SUFFIX_NAMES = [
  'Bane', 'Root', 'Bite', 'Song', 'Roar', 'Grasp', 'Instrument', 'Glow', 'Bender', 'Shadow',
  'Whisper', 'Shout', 'Growl', 'Tear', 'Peak', 'Form', 'Sun', 'Moon',
];
/** "Victory Song" for an ordinary Beast, null for Genesis. Affixes number from 1. */
export const affixName = (beast) => (isGenesis(beast) ? null : `${PREFIX_NAMES[beast.prefix - 1]} ${SUFFIX_NAMES[beast.suffix - 1]}`);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, id] = process.argv.slice(2);
  if (command !== 'decode' || !id) {
    console.error('usage: node token-id.mjs decode <tokenId>');
    process.exit(2);
  }
  const beast = decodeTokenId(id);
  console.log(
    JSON.stringify(
      { ...beast, beastTypeName: BEAST_TYPES[beast.beastType], affixName: affixName(beast), genesis: isGenesis(beast) },
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      2,
    ),
  );
}
