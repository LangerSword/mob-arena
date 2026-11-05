#!/usr/bin/env node
// Read-only Beasts helper. Zero dependencies; Node 18+. It never signs or sends a transaction.
//
//   node beasts-read.mjs [--network sepolia|mainnet] [--rpc <url>] <command>
//
//   stack                         Chain ID, wiring, supply, registration state
//   species <id>                  Name, traits, minter, sound manager, renderer, Genesis ID
//   tokens <speciesId>            Live ordinary token IDs of a species
//   slot <speciesId> <prefix> <suffix>   Token ID in an affix slot, or free
//   beast <tokenId>               Decoded fields plus owner, rank, grade, lock, damage
//   tracks <tokenId>              Sound manager, track counts, selected track and mode
//   uri <tokenId> [--out <dir>]   token_uri metadata; --out saves metadata, image, player
//   owned <address> [--limit n]   Beasts held by an address
//   abi <contract|address> [--out <file>]   ABI of a deployed contract
//   call <contract|address> <entrypoint> [felt ...] [--full]   Any view, by name
//   track <tokenId> <ref> [--out x.mid]   One track's MIDI; <ref> is active, named, shared:<id> or individual:<id>
//
// <contract> is one of the names in the ADDRESSES table below. BEASTS_RPC_URL
// overrides the default RPC, and --rpc overrides both.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BEAST_TYPES, affixName, beastPower, decodeTokenId, isGenesis, tokenIdToFelt, tokenIdToU256 } from './token-id.mjs';

export const ADDRESSES = {
  sepolia: {
    nft: '0x2e2f3e29a04f92c2b4e8b91fa846d521aea2a682e490bdf46f18da6d0a8bbe1',
    registry: '0x7f6883b4f901ce25aff2b10c876db8dfff68e61ba93102354816519e7fe1f',
    soundManager: '0x49203ee761fab21814b387938064bc3535c35b10ab62a4877aeb8bbc059e305',
    skull: '0xeb4a778751c2fc690c8a872e10bbd89c9aa1a72ce4155af717259908d6812d',
    renderer: '0x711ce0a203434e8ce79ae90366e32d1289f5c07ae02de9a9226f3948f2761a4',
    classicRenderer: '0x62c1fa7709c3270fe8043b38dc3c360b689929ce176ba8288d910cf0d4dbecd',
    artProvider: '0x2a2f693c348375bd8bc71e9ab0a22a354b053270f769f35359a4d5e454d9d07',
    credential: '0x4472df7966be9fce5274a3ac96f106ce45ade7e36cc4812660182f36e2a6439',
  },
  mainnet: {
    nft: '0xf739e402e52830a736335a0f47d58ec78ba067443c9c6930da182eab2ff8b0',
    registry: '0x140e8868c7c9277b8b864d78efb5172a42d41e0b501329b043db7d2cb3bc8b3',
    soundManager: '0x1bbece5870dabbbec40efb73457848fd5425320600a42684aa23271c43abe8b',
    skull: '0x2798a8dc91bf1ef502cf8710751d26128fdf8e9d0823522fc08632ecc9172e8',
    renderer: '0x1a75c643d98a987cfd962bc05768ddc1bed96857668217ff8367e1006c25a0c',
    classicRenderer: '0x1cda1fa6d9d97f484603e32a7958cc0693dc971582319b9577b136d23019bd5',
    artProvider: '0x7a1b0c5b8d7d37ed52bc2c0866acea4100aa18f66eae82dc565546ce56c2b7b',
    credential: '0x4b518b55a93fcd540388fc564867a5a826456c15ebbb53b94a7687e42ee7ef1',
  },
};

export const DEFAULT_RPC = {
  sepolia: 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/alch_mAm2Rh8vg2fbpMYO7LoJe',
  mainnet: 'https://api.zan.top/public/starknet-mainnet/rpc/v0_10',
};

const CHAIN_IDS = { sepolia: '0x534e5f5345504f4c4941', mainnet: '0x534e5f4d41494e' };

// ---- sn_keccak: Keccak-256 of the name, masked to 250 bits. node:crypto has only NIST SHA3.
const ROTATION = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const M64 = (1n << 64n) - 1n;
const rotl = (x, n) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64;
function keccak256(bytes) {
  const rate = 136;
  const padded = new Uint8Array(Math.floor(bytes.length / rate + 1) * rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
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
/** The entry point selector: sn_keccak of its name. */
export const selector = (name) => '0x' + (keccak256(new TextEncoder().encode(name)) & ((1n << 250n) - 1n)).toString(16);

/** The contract's own panic text from a revert trace, skipping the generic wrapper. Null if there is none. */
export function revertReason(trace) {
  const reasons = [...String(trace).matchAll(/\('([^']*)'\)/g)].map((m) => m[1]).filter((r) => r !== 'ENTRYPOINT_FAILED');
  return reasons[0] ?? null;
}

// ---- RPC
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRYABLE = /limit|too many|too fast|rate|timeout|temporar/i;

export async function rpc(url, method, params) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        lastError = new Error(`RPC HTTP ${response.status}: ${text.slice(0, 200)}`);
        if (response.status === 429 || response.status >= 500) continue;
        throw lastError;
      }
      if (body.result !== undefined) return body.result;
      const message = JSON.stringify(body.error);
      const hint = message.includes('0x4f7574206f6620676173')
        ? " Revert 'Out of gas': this RPC's call gas limit is too low for this view, so use another RPC (see references/networks.md)."
        : '';
      const reason = revertReason(message);
      lastError = new Error(reason ? `${method} reverted: ${reason}` : `RPC error in ${method}: ${message.slice(0, 1500)}${hint}`);
      if (RETRYABLE.test(message) && !/out of gas/i.test(message) && !/execution/i.test(message)) continue;
      throw lastError;
    } catch (error) {
      lastError = error;
      if (!(error instanceof TypeError)) throw error; // fetch network failures are TypeErrors
    }
  }
  throw lastError;
}

export const call = (url, to, entrypoint, calldata = []) =>
  rpc(url, 'starknet_call', [
    { contract_address: to, entry_point_selector: selector(entrypoint), calldata: calldata.map((v) => '0x' + BigInt(v).toString(16)) },
    'latest',
  ]);

// ---- Decoding
/** A Cairo ByteArray as raw bytes. Use this for binary content such as MIDI. */
export function decodeByteArrayBytes(felts, start = 0) {
  const words = Number(BigInt(felts[start]));
  const bytes = [];
  const push = (felt, length) => {
    const hex = BigInt(felt).toString(16).padStart(length * 2, '0');
    for (let i = 0; i < length; i++) bytes.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  };
  for (let i = 0; i < words; i++) push(felts[start + 1 + i], 31);
  push(felts[start + 1 + words], Number(BigInt(felts[start + 2 + words])));
  return Buffer.from(bytes);
}
/** A Cairo ByteArray as UTF-8 text. Corrupts binary content, so use decodeByteArrayBytes for MIDI. */
export const decodeByteArray = (felts, start = 0) => decodeByteArrayBytes(felts, start).toString('utf8');
export const shortString = (felt) => {
  const hex = BigInt(felt).toString(16);
  return Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex').toString('utf8');
};
const u256 = (low, high) => BigInt(low) + (BigInt(high) << 128n);

/** Reads one TrackRef: Shared(id) [0,id], Individual(id) [1,id], Named [2]. */
function trackRef(felts, at) {
  const variant = Number(BigInt(felts[at]));
  if (variant === 2) return { text: 'Named', next: at + 1 };
  const id = BigInt(felts[at + 1]).toString();
  return { text: `${variant === 0 ? 'Shared' : 'Individual'}(${id})`, next: at + 2 };
}
/** Reads one SoundMode: Live [0], Original [1], AtBlock(n) [2,n]. */
function soundMode(felts, at) {
  const variant = Number(BigInt(felts[at]));
  if (variant === 2) return { text: `AtBlock(${BigInt(felts[at + 1])})`, next: at + 2 };
  return { text: variant === 0 ? 'Live' : 'Original', next: at + 1 };
}
/** Cairo Option: Some is variant 0, None is variant 1. */
function option(felts, at, read) {
  if (Number(BigInt(felts[at])) === 1) return { text: 'None', next: at + 1 };
  return read(felts, at + 1);
}
export function decodeSoundState(felts) {
  const a = option(felts, 0, trackRef);
  const b = option(felts, a.next, trackRef);
  const c = option(felts, b.next, trackRef);
  const d = option(felts, c.next, soundMode);
  return { speciesDefault: a.text, trackOverride: b.text, effectiveTrack: c.text, effectiveMode: d.text };
}

const print = (value) => console.log(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
const hexId = (value) => '0x' + BigInt(value).toString(16);
const isZero = (value) => BigInt(value) === 0n;

function dataUri(uri) {
  const match = /^data:([^,;]+)(;base64)?,/.exec(uri);
  if (!match) return null;
  const payload = uri.slice(match[0].length);
  return { mime: match[1], bytes: match[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload)) };
}

/** Parses token_uri's returned felts into the metadata JSON. */
export function parseTokenUri(felts) {
  const uri = decodeByteArray(felts);
  const parsed = dataUri(uri);
  if (!parsed) throw new Error(`token_uri is not a data URI: ${uri.slice(0, 60)}`);
  return { uri, metadata: JSON.parse(parsed.bytes.toString('utf8')), felts: felts.length };
}

/** Fetches token_uri (u256 ID) and parses the metadata JSON. */
export const readMetadata = async (url, nft, tokenId) => parseTokenUri(await call(url, nft, 'token_uri', tokenIdToU256(tokenId)));

/** Saves metadata.json plus the decoded image and player. Returns the file names. */
export function saveMetadata(metadata, dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  const saved = ['metadata.json'];
  for (const [key, stem] of [['image', 'image'], ['animation_url', 'player']]) {
    const parsed = metadata[key] && dataUri(metadata[key]);
    if (!parsed) continue;
    const extension = { 'image/svg+xml': 'svg', 'text/html': 'html', 'image/gif': 'gif', 'image/png': 'png' }[parsed.mime] ?? 'bin';
    writeFileSync(join(dir, `${stem}.${extension}`), parsed.bytes);
    saved.push(`${stem}.${extension}`);
  }
  return saved;
}

/** A track reference as calldata: active is null, named [2], shared:<id> [0, id], individual:<id> [1, id]. */
export function trackRefCalldata(ref) {
  if (ref === 'active') return null;
  if (ref === 'named') return [2];
  const match = /^(shared|individual):(\d+)$/.exec(ref);
  if (!match) throw new Error(`track ref must be active, named, shared:<id> or individual:<id>, not ${ref}`);
  return [match[1] === 'shared' ? 0 : 1, match[2]];
}

async function main(argv) {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--full') flags.full = true;
    else if (['--network', '--rpc', '--out', '--limit'].includes(argv[i])) flags[argv[i].slice(2)] = argv[++i];
    else args.push(argv[i]);
  }
  const network = flags.network ?? 'sepolia';
  if (!ADDRESSES[network]) throw new Error(`unknown network ${network}`);
  const url = flags.rpc ?? process.env.BEASTS_RPC_URL ?? DEFAULT_RPC[network];
  const a = ADDRESSES[network];
  const [command, ...rest] = args;
  const need = (value, name) => {
    if (value === undefined) throw new Error(`${command}: missing ${name}`);
    return value;
  };
  const resolve = (name) => a[name] ?? (/^0x[0-9a-fA-F]+$/.test(name) ? name : null);

  switch (command) {
    case 'stack': {
      const chainId = await rpc(url, 'starknet_chainId', []);
      if (BigInt(chainId) !== BigInt(CHAIN_IDS[network])) throw new Error(`RPC is on chain ${chainId}, not ${network}`);
      const supply = await call(url, a.nft, 'total_supply');
      const species = await call(url, a.registry, 'species_count');
      const cursors = await call(url, a.registry, 'get_species_id_cursors');
      const open = await call(url, a.registry, 'is_registration_open');
      const registryNft = await call(url, a.registry, 'get_nft_address');
      print({
        network,
        chainId,
        block: await rpc(url, 'starknet_blockNumber', []),
        nft: a.nft,
        registry: a.registry,
        wiringOk: BigInt(registryNft[0]) === BigInt(a.nft),
        totalSupply: u256(supply[0], supply[1]),
        speciesCount: BigInt(species[0]),
        nextReservedId: BigInt(cursors[0]),
        nextCommunityId: BigInt(cursors[1]),
        registrationOpen: !isZero(open[0]),
      });
      return;
    }
    case 'species': {
      const id = need(rest[0], 'species ID');
      if (isZero((await call(url, a.registry, 'is_registered', [id]))[0])) {
        print({ speciesId: id, registered: false });
        return;
      }
      const [name] = await call(url, a.registry, 'get_species_name', [id]);
      const [tier, type] = await call(url, a.registry, 'get_species_traits', [id]);
      const [minter] = await call(url, a.registry, 'get_minter', [id]);
      const [locked] = await call(url, a.registry, 'is_minter_locked', [id]);
      const [manager] = await call(url, a.registry, 'get_sound_manager', [id]);
      const [renderer] = await call(url, a.registry, 'get_renderer', [id]);
      const [art] = await call(url, a.registry, 'get_art_provider', [id]);
      const [genesis] = await call(url, a.nft, 'get_genesis_token_id', [id]);
      const [count] = await call(url, a.nft, 'get_species_count', [id]);
      print({
        speciesId: id,
        registered: true,
        name: shortString(name),
        tier: Number(BigInt(tier)),
        beastType: BEAST_TYPES[Number(BigInt(type))],
        minter,
        minterLocked: !isZero(locked),
        soundManager: manager,
        renderer: isZero(renderer) ? 'NFT default' : renderer,
        artProvider: art,
        genesisTokenId: genesis,
        liveOrdinaryBeasts: BigInt(count),
      });
      return;
    }
    case 'tokens': {
      const felts = await call(url, a.nft, 'get_species_token_ids', [need(rest[0], 'species ID')]);
      print({ speciesId: rest[0], count: felts.length - 1, tokenIds: felts.slice(1) });
      return;
    }
    case 'slot': {
      const [species, prefix, suffix] = [need(rest[0], 'species ID'), need(rest[1], 'prefix'), need(rest[2], 'suffix')];
      const [id] = await call(url, a.nft, 'get_token_id_by_affixes', [species, prefix, suffix]);
      print({ speciesId: species, prefix, suffix, tokenId: isZero(id) ? null : id, free: isZero(id) });
      return;
    }
    case 'beast': {
      const id = need(rest[0], 'token ID');
      const beast = decodeTokenId(id);
      const felt = [tokenIdToFelt(id)];
      const [owner] = await call(url, a.nft, 'owner_of', tokenIdToU256(id));
      const [rank] = await call(url, a.nft, 'get_beast_rank', felt);
      const [grade] = await call(url, a.nft, 'get_card_grade', felt);
      const [lockedUntil] = await call(url, a.nft, 'transfer_locked_until', felt);
      const [damage] = await call(url, a.nft, 'get_transfer_damage_count', felt);
      print({
        tokenId: hexId(id),
        owner,
        name: affixName(beast),
        genesis: isGenesis(beast),
        beastTypeName: BEAST_TYPES[beast.beastType],
        power: beastPower(beast),
        rank: Number(BigInt(rank)),
        cardGrade: Number(BigInt(grade)),
        transferLockedUntil: BigInt(lockedUntil),
        transferDamageCount: BigInt(damage),
        decoded: beast,
      });
      return;
    }
    case 'tracks': {
      const id = need(rest[0], 'token ID');
      const beast = decodeTokenId(id);
      const [manager] = await call(url, a.registry, 'get_sound_manager', [beast.speciesId]);
      if (isZero(manager)) {
        print({ tokenId: hexId(id), soundManager: null, note: 'This species has sound disabled.' });
        return;
      }
      const felt = [tokenIdToFelt(id)];
      const counts = await call(url, manager, 'get_track_counts', felt);
      const state = await call(url, manager, 'get_sound_state', felt);
      const [shared, named, individual] = counts.map((v) => BigInt(v));
      print({
        tokenId: hexId(id),
        soundManager: manager,
        counts: { shared, named, individual, total: shared + named + individual },
        ...decodeSoundState(state),
      });
      return;
    }
    case 'uri': {
      const id = need(rest[0], 'token ID');
      const { uri, metadata, felts } = await readMetadata(url, a.nft, id);
      const summary = {
        name: metadata.name,
        description: metadata.description?.slice(0, 160),
        uriBytes: uri.length,
        returnedFelts: felts,
        image: metadata.image?.slice(0, 40),
        animationUrl: metadata.animation_url?.slice(0, 40) ?? null,
        attributes: Object.fromEntries((metadata.attributes ?? []).map((t) => [t.trait_type, t.value])),
      };
      if (flags.out) summary.saved = saveMetadata(metadata, flags.out);
      print(summary);
      return;
    }
    case 'owned': {
      const owner = need(rest[0], 'address');
      const balance = await call(url, a.nft, 'balance_of', [owner]);
      const total = u256(balance[0], balance[1]);
      const limit = BigInt(flags.limit ?? 25);
      const tokens = [];
      for (let i = 0n; i < total && i < limit; i++) {
        const [id] = await call(url, a.nft, 'token_of_owner_by_index', [owner, i, 0n]);
        tokens.push(id);
      }
      print({ owner, balance: total, listed: tokens.length, tokenIds: tokens });
      return;
    }
    case 'abi': {
      const address = resolve(need(rest[0], 'contract'));
      if (!address) throw new Error(`unknown contract ${rest[0]}; names: ${Object.keys(a).join(', ')}`);
      const cls = await rpc(url, 'starknet_getClassAt', ['latest', address]);
      const abi = typeof cls.abi === 'string' ? JSON.parse(cls.abi) : cls.abi;
      if (flags.out) {
        writeFileSync(flags.out, JSON.stringify(abi, null, 2));
        print({ address, entries: abi.length, saved: flags.out });
      } else {
        const names = abi.flatMap((e) => (e.type === 'interface' ? e.items : [e])).filter((e) => e.type === 'function');
        print({ address, entries: abi.length, functions: names.map((f) => `${f.name} (${f.state_mutability})`) });
      }
      return;
    }
    case 'call': {
      const address = resolve(need(rest[0], 'contract'));
      if (!address) throw new Error(`unknown contract ${rest[0]}; names: ${Object.keys(a).join(', ')}`);
      const felts = await call(url, address, need(rest[1], 'entrypoint'), rest.slice(2));
      print({ length: felts.length, result: flags.full || felts.length <= 40 ? felts : [...felts.slice(0, 40), `... use --full for all ${felts.length}`] });
      return;
    }
    case 'track': {
      const id = need(rest[0], 'token ID');
      const reference = trackRefCalldata(need(rest[1], 'track ref'));
      const [manager] = await call(url, a.registry, 'get_sound_manager', [decodeTokenId(id).speciesId]);
      if (isZero(manager)) throw new Error('This species has sound disabled.');
      const felt = tokenIdToFelt(id);
      const felts = reference
        ? await call(url, manager, 'get_track_sound', [felt, ...reference])
        : await call(url, manager, 'get_beast_sound', [felt]);
      // get_beast_sound returns Option<TinySynthSound>: Some is [0, ...], None is [1].
      if (!reference && Number(BigInt(felts[0])) === 1) throw new Error('This token has no active track.');
      const midi = decodeByteArrayBytes(felts, reference ? 0 : 1);
      if (midi.subarray(0, 4).toString('latin1') !== 'MThd') throw new Error('The returned bytes are not MIDI.');
      if (flags.out) writeFileSync(flags.out, midi);
      print({ tokenId: hexId(id), soundManager: manager, ref: rest[1], returnedFelts: felts.length, midiBytes: midi.length, saved: flags.out ?? null });
      return;
    }
    default:
      console.error('commands: stack, species, tokens, slot, beast, tracks, uri, owned, abi, call, track. See the top of this file.');
      process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
