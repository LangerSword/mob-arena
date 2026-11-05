// Reads live Beasts from Starknet, no wallet needed. Browser-friendly: uses fetch,
// never Node builtins. Point it at any Sepolia or mainnet RPC via ?rpc= or BEASTS_RPC_URL.
//
//   import { listSpecies, getBeast, tokenUri } from './src/chain.mjs'

const DEFAULTS = {
  sepolia: {
    // Two endpoints, because no single one serves every call:
    // PublicNode handles transactions and ordinary reads, but reverts token_uri with "Out of gas".
    // Zan serves token_uri. See the skill's references/networks.md.
    rpc: 'https://starknet-sepolia-rpc.publicnode.com',
    heavyRpc: 'https://api.zan.top/public/starknet-sepolia/rpc/v0_10',
    nft: '0x2e2f3e29a04f92c2b4e8b91fa846d521aea2a682e490bdf46f18da6d0a8bbe1',
    registry: '0x7f6883b4f901ce25aff2b10c876db8dfff68e61ba93102354816519e7fe1f',
    soundManager: '0x49203ee761fab21814b387938064bc3535c35b10ab62a4877aeb8bbc059e305',
  },
  mainnet: {
    rpc: 'https://api.zan.top/public/starknet-mainnet/rpc/v0_10',
    heavyRpc: 'https://api.zan.top/public/starknet-mainnet/rpc/v0_10',
    nft: '0xf739e402e52830a736335a0f47d58ec78ba067443c9c6930da182eab2ff8b0',
    registry: '0x140e8868c7c9277b8b864d78efb5172a42d41e0b501329b043db7d2cb3bc8b3',
    soundManager: '0x1bbece5870dabbbec40efb73457848fd5425320600a42684aa23271c43abe8b',
  },
};

export function config(network = 'sepolia') {
  return DEFAULTS[network] ?? DEFAULTS.sepolia;
}

/** sn_keccak, needed for the entrypoint selector. Browser-safe. */
export function selector(name) {
  const bytes = new TextEncoder().encode(name);
  return '0x' + (keccak(bytes) & ((1n << 250n) - 1n)).toString(16);
}

function keccak(bytes) {
  const rate = 136;
  const padded = new Uint8Array(Math.floor(bytes.length / rate + 1) * rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const M64 = (1n << 64n) - 1n;
  const ROTATION = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
  const PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
  const RC = [0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n,
    0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an,
    0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
  const rotl = (x, n) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      s[i] ^= lane;
    }
    for (let round = 0; round < 24; round++) {
      const c = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
      for (let x = 0; x < 5; x++) {
        const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
        for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
      }
      let t = s[1];
      for (let i = 0; i < 24; i++) {
        const j = PILN[i];
        const tmp = s[j];
        s[j] = rotl(t, ROTATION[i]);
        t = tmp;
      }
      for (let y = 0; y < 25; y += 5) {
        const row = s.slice(y, y + 5);
        for (let x = 0; x < 5; x++) s[y + x] = row[x] ^ (~row[(x + 1) % 5] & M64 & row[(x + 2) % 5]);
      }
      s[0] ^= RC[round];
    }
  }
  let out = 0n;
  for (let i = 0; i < 4; i++) {
    for (let b = 0n; b < 8n; b++) out = (out << 8n) | ((s[i] >> (8n * b)) & 0xffn);
  }
  return out;
}

/** One JSON-RPC call. */
export async function rpcCall(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
  return json.result;
}

const hex = (v) => '0x' + BigInt(v).toString(16);

/** A contract view with raw felts. */
export function call(url, to, entrypoint, calldata = []) {
  return rpcCall(url, 'starknet_call', [{ contract_address: to, entry_point_selector: selector(entrypoint), calldata }, 'latest'])
    .then((result) => result.map((x) => BigInt(x)));
}

/** u256 as [low, high], for ERC-721 entry points. */
export const toU256 = (id) => [hex(BigInt(id) & ((1n << 128n) - 1n)), hex(BigInt(id) >> 128n)];

/** Decodes a ByteArray result: [n, ...words, pending_word, pending_len]. */
export function decodeByteArray(felts, start = 0) {
  const words = Number(felts[start]);
  let out = '';
  let at = start + 1;
  for (let i = 0; i < words; i++) {
    out += BigInt(felts[at]).toString(16).padStart(62, '0');
    at++;
  }
  const pending = BigInt(felts[at]);
  const len = Number(felts[at + 1]);
  if (len > 0) out += pending.toString(16).padStart(len * 2, '0');
  return out.replace(/(.{2})/g, '$1').replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)));
}

/** Token metadata: name, attributes, image, animation_url. Uses the heavy endpoint, which serves token_uri. */
export async function tokenUri(url, network, tokenId) {
  const { nft, heavyRpc } = config(network);
  const felts = await call(heavyRpc, nft, 'token_uri', toU256(tokenId));
  const json = decodeByteArray(felts);
  const match = /^data:([^,;]+)(;base64)?,/.exec(json);
  if (!match) throw new Error('token_uri is not a data URI');
  const payload = json.slice(match[0].length);
  const bytes = match[2] ? atob(payload) : decodeURIComponent(payload);
  return JSON.parse(bytes);
}

/** The onchain name of a species. */
export function speciesName(url, network, speciesId) {
  const { registry } = config(network);
  return call(url, registry, 'get_species_name', [hex(speciesId)]).then((r) => shortString(r[0]));
}

/** Total registered species, from the chain. */
export function speciesCount(url, network) {
  const { registry } = config(network);
  return call(url, registry, 'species_count', []).then((r) => Number(r[0]));
}

/** Reads species IDs and names up to `limit`, skipping gaps. */
export async function listSpecies(url, network, limit = 12) {
  const total = await speciesCount(url, network);
  const out = [];
  for (let id = 1; id <= total && out.length < limit; id++) {
    try {
      const name = await speciesName(url, network, id);
      out.push({ id, name });
    } catch {
      // unregistered gap
    }
  }
  return out;
}

export function shortString(felt) {
  const hexStr = BigInt(felt).toString(16).padStart(2, '0');
  return hexStr.replace(/(.{2})/g, '$1').replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)));
}

/** All live ordinary token IDs of a species. */
export async function speciesTokens(url, network, speciesId) {
  const { nft } = config(network);
  const felts = await call(url, nft, 'get_species_token_ids', [hex(speciesId)]);
  const count = Number(felts[0]);
  return felts.slice(1, 1 + count).map((x) => BigInt(x));
}

/** Owner, rank and grade for a token. */
export async function tokenFacts(url, network, tokenId) {
  const { nft } = config(network);
  const [owner, rank, grade] = await Promise.all([
    call(url, nft, 'owner_of', toU256(tokenId)).then((r) => r[0]),
    call(url, nft, 'get_beast_rank', [hex(tokenId)]).then((r) => Number(r[0])),
    call(url, nft, 'get_card_grade', [hex(tokenId)]).then((r) => Number(r[0])),
  ]);
  return { owner, rank, grade };
}

export const SPECIES_NAMES = ['Warlock', 'Revenant', 'Golem', 'Wraith', 'Chimera', 'Basilisk', 'Leviathan', 'Phoenix',
  'Manticore', 'Kraken', 'Hydra', 'Griffin', 'Sphinx', 'Cerberus', 'Minotaur', 'Cyclops', 'Banshee', 'Djinn',
  'Ifrit', 'Salamander', 'Unicorn', 'Pegasus', 'Kelpie', 'Selkie', 'Nymph', 'Satyr', 'Faun', 'Troll', 'Ogre',
  'Giant', 'Dwarf', 'Elf', 'Fairy', 'Pixie', 'Sprite', 'Imp', 'Demon', 'Angel', 'Seraph', 'Cherub', 'Valkyrie',
  'Berserker', 'Shaman', 'Druid', 'Ranger', 'Monk', 'Paladin', 'Knight', 'Sorcerer', 'Wizard', 'Alchemist',
  'Necromancer', 'Warlord', 'Assassin', 'Rogue', 'Bard', 'Cleric', 'Priest', 'Acolyte', 'Initiate', 'Adept',
  'Mystic', 'Seer', 'Oracle', 'Prophet', 'Sage', 'Scholar', 'Lorekeeper', 'Warden', 'Keeper', 'Guardian'];

export const PREFIX_NAMES = ['Victory', 'Golden', 'Shadow', 'Iron', 'Crimson', 'Azure', 'Emerald', 'Obsidian',
  'Radiant', 'Umbral', 'Storm', 'Frost', 'Ember', 'Void', 'Astral', 'Lunar', 'Solar', 'Stellar', 'Nebula',
  'Quasar', 'Pulsar', 'Comet', 'Meteor', 'Aurora', 'Zephyr', 'Tempest', 'Cyclone', 'Tsunami', 'Volcano',
  'Glacier', 'Tundra', 'Savanna', 'Jungle', 'Coral', 'Abyss', 'Summit', 'Canyon', 'Delta', 'Lagoon', 'Reef',
  'Atoll', 'Fjord', 'Mesa', 'Dune', 'Oasis', 'Mirage', 'Phantom', 'Specter', 'Wisp', 'Shade', 'Gloom', 'Dusk',
  'Dawn', 'Twilight', 'Midnight', 'Zenith', 'Nadir', 'Apex', 'Pinnacle', 'Crest', 'Crown', 'Throne', 'Scepter',
  'Banner', 'Standard', 'Sigil', 'Rune', 'Glyph', 'Cipher'];

export const SUFFIX_NAMES = ['Song', 'Roar', 'Whisper', 'Howl', 'Cry', 'Call', 'Chant', 'Hymn', 'Ballad', 'Dirge',
  'Lament', 'Revel', 'Rhapsody', 'Anthem', 'Ode', 'Verse', 'Refrain', 'Chorus', 'Cadenza', 'Aria', 'Etude',
  'Nocturne', 'Serenade', 'Sonata', 'Symphony'];

export function affixName(beast) {
  if (beast.prefix === 0 && beast.suffix === 0) return null;
  return `${PREFIX_NAMES[beast.prefix - 1] ?? ''} ${SUFFIX_NAMES[beast.suffix - 1] ?? ''}`.trim();
}

/** Decodes a token ID offline, no RPC. Mirrors the skill's codec. */
export function decodeTokenId(tokenId) {
  const packed = BigInt(tokenId);
  if (packed >> 251n) throw new Error('tokenId has nonzero bits above bit 250');
  const low = packed & ((1n << 128n) - 1n);
  const high = packed >> 128n;
  const word = low & ((1n << 64n) - 1n);
  const mask = (bits) => (1n << BigInt(bits)) - 1n;
  const read = (shift, bits) => Number((word >> BigInt(shift)) & mask(bits));
  const speciesId = Number(high >> 91n);
  const group = high >> 53n;
  const tier = Number((group >> 35n) & mask(3));
  const beastType = Number((group >> 32n) & mask(3));
  const level = Number((group >> 16n) & mask(16));
  const health = Number(group & mask(16));
  const prefix = Number((high >> 46n) & mask(7));
  const suffix = Number((high >> 41n) & mask(5));
  if (tier < 1 || tier > 5) throw new Error(`tier out of range: ${tier}`);
  if (beastType > 2) throw new Error(`beastType out of range: ${beastType}`);
  if ((prefix === 0) !== (suffix === 0)) throw new Error('invalid affix combo');
  return {
    tokenId: tokenId.toString(), speciesId, tier, beastType, level, health, prefix, suffix,
    mintedAtBlockNumber: Number(low >> 96n),
    mintedAtMinute: Number(high & mask(27)),
    transferLockHours: Number((high >> 27n) & mask(14)),
    minterData: Number((low >> 64n) & mask(32)),
    transferDamageChance: read(53, 11),
    visualEffects: read(48, 5),
    soundEffects: read(43, 5),
    cornerChipLevel: read(41, 2),
    edgeChipLevel: read(39, 2),
    rollersInArt: read(38, 1),
    rollerLevel: read(36, 2),
    voidsInArt: read(35, 1),
    voidLevel: read(33, 2),
    hickeysInArt: read(32, 1),
    hickeyCount: read(30, 2),
    centeringYBps: 10000 - read(15, 14),
    centeringXDirection: read(14, 1),
    centeringXBps: 10000 - read(0, 14),
  };
}
