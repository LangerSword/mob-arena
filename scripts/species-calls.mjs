#!/usr/bin/env node
// Builds Beasts registration and mint calls, and dry-runs them. Zero dependencies; Node 18+.
// It holds no key and sends nothing: the calls it returns work with starknet.js
// account.execute(), and `simulate` only asks the RPC what would happen.
//
//   node species-calls.mjs simulate --account 0x... --name "Moss Golem" --art ./art.png \
//     [--art-png f] [--art-shiny f] [--art-gif f] [--art-gif-shiny f] \
//     [--tier 3] [--type 1] [--royalty-bps 0] [--description "..."] [--network sepolia] \
//     [--prefix 1] [--suffix 1] [--level 5] [--health 100] [--effects 0] \
//     [--sound-manager originals|0x...] [--copy-track-from <speciesId>:<sharedId> | --inputs song.json] [--named]
//   node species-calls.mjs preview <the same flags> --out ./preview
//   node species-calls.mjs audition --inputs song.json [--effects 0] [--mode original|live|<block>] --out song.mid
//
// --type is 0 Magic, 1 Hunter, 2 Brute. `simulate` runs one multicall from --account:
// register a community species with that account as minter and owner, then mint one
// Beast of it, and reports the species ID, token ID and fee. Simulation skips signature
// validation and fee charging, so any deployed account address can be tested.
//
// --sound-manager routes the species to a Sound Manager; `originals` means the live one.
// --copy-track-from also adds that shared track to your species as its default, so every
// token has sound. It needs a manager that accepts it, such as the Originals one.
// --inputs does the same with your own ComposerInputs; references/sound.md has the format.
// --named also selects the minted token's Named Song. It runs with preview only.
//
// `preview` renders the unminted token inside the simulation and saves metadata.json,
// image.svg and player.html. `audition` composes inputs with a free view and saves the MIDI.

import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ADDRESSES, DEFAULT_RPC, call, decodeByteArrayBytes, parseTokenUri, revertReason, rpc, saveMetadata, selector } from './beasts-read.mjs';
import { tokenIdToU256 } from './token-id.mjs';

const hex = (v) => '0x' + BigInt(v).toString(16);

/** A Cairo ByteArray as calldata: full 31-byte words, pending word, pending length. */
export function byteArrayCalldata(text) {
  const bytes = Buffer.from(text, 'utf8');
  const fullWords = Math.floor(bytes.length / 31);
  const out = [hex(fullWords)];
  for (let i = 0; i < fullWords; i++) out.push('0x' + bytes.subarray(i * 31, (i + 1) * 31).toString('hex'));
  const pending = bytes.subarray(fullWords * 31);
  out.push(pending.length ? '0x' + pending.toString('hex') : '0x0', hex(pending.length));
  return out;
}

/** A felt252 short string, as species names are stored. At most 31 bytes. */
export function shortStringCalldata(text) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length === 0 || bytes.length > 31) throw new Error('name must be 1-31 bytes');
  return '0x' + bytes.toString('hex');
}

/** Letters, digits, space, apostrophe and hyphen, with no leading or trailing space. */
export function assertValidName(name) {
  if (!/^[A-Za-z0-9 '-]+$/.test(name) || name !== name.trim()) {
    throw new Error("name may use letters, digits, spaces, ' and -, with no leading or trailing space");
  }
}

/** Registers a community species (register_beast_with_art, reserved = false). */
export function registerWithArtCall({
  registry,
  name,
  beastType,
  tier,
  minter,
  speciesOwner,
  art,
  genesisTransferDamageChance = 0,
  soundManager = '0x0',
  genesisRecipient = '0x0',
  royaltyBps = 0,
  description = '',
  renderer = '0x0',
  genesisVisualEffects = 3,
  genesisSoundEffects = 3,
}) {
  assertValidName(name);
  return {
    contractAddress: registry,
    entrypoint: 'register_beast_with_art',
    calldata: [
      shortStringCalldata(name),
      hex(beastType),
      hex(tier),
      hex(minter),
      hex(genesisTransferDamageChance),
      hex(soundManager),
      hex(genesisRecipient),
      hex(speciesOwner),
      hex(royaltyBps),
      ...byteArrayCalldata(description),
      hex(renderer),
      hex(genesisVisualEffects),
      hex(genesisSoundEffects),
      ...byteArrayCalldata(art.pngRegular),
      ...byteArrayCalldata(art.pngShiny),
      ...byteArrayCalldata(art.gifRegular),
      ...byteArrayCalldata(art.gifShiny),
      '0x0',
    ],
  };
}

export const PERFECT_CONDITION = {
  centeringXBps: 10000, centeringXDirection: 0, centeringYBps: 10000, centeringYDirection: 0,
  hickeyCount: 0, hickeysInArt: 0, voidLevel: 0, voidsInArt: 0, rollerLevel: 0, rollersInArt: 0,
  edgeChipLevel: 0, cornerChipLevel: 0,
};

/** Mints one Beast. Only the species' minter can send this. Keeps one effects preset. */
export function mintCall({
  nft, to, speciesId, prefix, suffix, level, health, effects = 0,
  transferDamageChance = 0, transferLockHours = 0n, minterData = 0, condition = PERFECT_CONDITION,
}) {
  const c = condition;
  return {
    contractAddress: nft,
    entrypoint: 'mint',
    calldata: [
      to, speciesId, prefix, suffix, level, health, effects, effects, transferDamageChance, transferLockHours, minterData,
      c.centeringXBps, c.centeringXDirection, c.centeringYBps, c.centeringYDirection,
      c.hickeyCount, c.hickeysInArt, c.voidLevel, c.voidsInArt, c.rollerLevel, c.rollersInArt,
      c.edgeChipLevel, c.cornerChipLevel,
    ].map(hex),
  };
}

/**
 * A shared track's composer inputs, as calldata you can pass to addSharedTrackCall.
 * Reads get_shared_tracks: Page { total, next_start: Option<u64>, items }, where each item
 * is { id, birth_block, input_format_version, inputs, default_mode }.
 */
export async function readSharedTrackInputs(url, manager, speciesId, sharedId) {
  const page = await call(url, manager, 'get_shared_tracks', [speciesId, sharedId, 1]);
  const itemsLengthAt = BigInt(page[1]) === 0n ? 3 : 2; // Option: Some is [0, value], None is [1]
  if (BigInt(page[itemsLengthAt]) !== 1n) throw new Error(`species ${speciesId} has no shared track ${sharedId}`);
  // SoundMode: Live [0], Original [1], or AtBlock [2, block]. A real block is never 0 or 1.
  const modeFelts = BigInt(page[page.length - 1]) <= 1n ? 1 : 2;
  return page.slice(itemsLengthAt + 4, page.length - modeFelts);
}

/** Adds a shared track. Only the species owner can send this. The first one becomes the default. */
export const addSharedTrackCall = ({ manager, speciesId, inputs }) => ({
  contractAddress: manager,
  entrypoint: 'add_shared_track',
  calldata: [hex(speciesId), ...inputs.map(hex)],
});

/** Selects this token's Named Song. Only the token's owner can send this. TrackRef::Named is [2]. */
export const selectNamedSongCall = ({ manager, tokenId }) => ({
  contractAddress: manager,
  entrypoint: 'set_default_track',
  calldata: [hex(tokenId), '0x2'],
});

/** A read inside a simulated multicall, used to render a token that does not exist yet. */
export const viewCall = (contractAddress, entrypoint, calldata = []) => ({ contractAddress, entrypoint, calldata: calldata.map(hex) });

/** ComposerInputs::SoundCheck as calldata, from labelled fields. */
export function soundCheckInputs(f, speciesId) {
  const identity = f.identity ?? {};
  return [
    0, identity.source_species_id ?? speciesId, field(identity, 'name_variant_id', 'identity'),
    field(f, 'mode_id', 'sound_check'), field(f, 'tonic_keynum', 'sound_check'), field(f, 'family', 'sound_check'),
    field(f, 'tempo_us', 'sound_check'), field(f, 'velocity_ceiling', 'sound_check'), field(f, 'articulation_profile', 'sound_check'),
  ].map(hex);
}

/** ComposerInputs::Song as calldata, from labelled fields. source_species_id defaults to your species. */
export function songInputs(f, speciesId) {
  const { theme, score, treatment, arrangement } = f;
  if (!theme || !score || !treatment || !arrangement) throw new Error('a song needs theme, score, treatment and arrangement');
  const identity = arrangement.identity ?? {};
  const policy = arrangement.channel_policy ?? 'genesis';
  const special = arrangement.special ?? 'none';
  return [
    1,
    ...['motif_seed', 'tier', 'register_band'].map((k) => field(theme, k, 'theme')),
    ...['mode_id', 'tonic_keynum', 'tier', 'weakness', 'voice_count', 'section_count', 'stretto_lag', 'use_inversion',
      'use_countersubject', 'ornament_density', 'articulation_profile', 'velocity_ceiling', 'tempo_us'].map((k) => field(score, k, 'score')),
    ...['rhythm_seed', 'flip_side', 'development', 'direction', 'spacing', 'trill', 'prominence', 'section_rhythm'].map((k) => field(treatment, k, 'treatment')),
    field(arrangement, 'family', 'arrangement'),
    identity.source_species_id ?? speciesId, field(identity, 'name_variant_id', 'identity'),
    field(arrangement, 'channel_count', 'arrangement'),
    ...(policy === 'genesis' ? [0] : [1, field(policy, 'seeded', 'channel_policy')]),
    ...(special === 'none' ? [0] : [1, field(special, 'yeti', 'special')]),
    ...['top_lead', 'balanced', 'weak_ties'].map((k) => field(arrangement, k, 'arrangement')),
  ].map(hex);
}

function field(object, key, where) {
  const value = object[key];
  if (value === undefined) throw new Error(`${where}.${key} is missing`);
  return value === true ? 1 : value === false ? 0 : value;
}

/** Turns --inputs JSON into calldata: { song: {...} }, { sound_check: {...} }, or an array of raw felts. */
export function composerInputsCalldata(json, speciesId) {
  if (Array.isArray(json)) return json.map(hex);
  if (json.song) return songInputs(json.song, speciesId);
  if (json.sound_check) return soundCheckInputs(json.sound_check, speciesId);
  throw new Error('inputs must be { song: ... }, { sound_check: ... } or an array of felts');
}

/** Splits an account __execute__ result [n, len1, ...r1, len2, ...r2] into one array per call. */
export function splitExecuteResult(retdata) {
  const results = [];
  let at = 1;
  for (let i = 0; i < Number(BigInt(retdata[0])); i++) {
    const length = Number(BigInt(retdata[at]));
    results.push(retdata.slice(at + 1, at + 1 + length));
    at += 1 + length;
  }
  return results;
}

/** Your species ID from a registration receipt: the registry's BeastRegistered event, keys [selector, species_id, species_owner]. */
export function speciesIdFromReceipt(receipt, registry) {
  const event = (receipt.events ?? []).find((e) => BigInt(e.from_address) === BigInt(registry) && BigInt(e.keys[0]) === BigInt(selector('BeastRegistered')));
  if (!event) throw new Error('no BeastRegistered event in this receipt');
  return BigInt(event.keys[1]);
}

/** Simulates a multicall from `account`. Sends nothing. Pass blockId to pin the state, and with it the minted ID. */
export async function simulate(url, account, calls, blockId = 'latest') {
  const execute = [hex(calls.length)];
  for (const c of calls) execute.push(hex(c.contractAddress), selector(c.entrypoint), hex(c.calldata.length), ...c.calldata);
  const nonce = await rpc(url, 'starknet_getNonce', ['latest', account]);
  const zero = { max_amount: '0x0', max_price_per_unit: '0x0' };
  const [result] = await rpc(url, 'starknet_simulateTransactions', [
    blockId,
    [{
      type: 'INVOKE', version: '0x3', sender_address: account, calldata: execute, signature: [], nonce,
      resource_bounds: {
        l1_gas: zero,
        l2_gas: { max_amount: '0xb2d05e00', max_price_per_unit: '0x0' },
        l1_data_gas: { max_amount: '0x186a0', max_price_per_unit: '0x0' },
      },
      tip: '0x0', paymaster_data: [], account_deployment_data: [],
      nonce_data_availability_mode: 'L1', fee_data_availability_mode: 'L1',
    }],
    ['SKIP_VALIDATE', 'SKIP_FEE_CHARGE'],
  ]);
  const invocation = result.transaction_trace.execute_invocation;
  if (invocation.revert_reason) {
    const reason = revertReason(invocation.revert_reason);
    throw new Error(`simulation reverted: ${reason ?? invocation.revert_reason.slice(0, 1500)}`);
  }
  return { retdata: invocation.result, feeFri: BigInt(result.fee_estimation.overall_fee) };
}

const MIME = { '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
/** A local image as the data URI registration stores. */
export function artDataUri(path) {
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) throw new Error(`unsupported art type ${extname(path)}`);
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

const BOOLEAN_FLAGS = new Set(['named']);
function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) throw new Error(`unexpected argument ${args[i]}`);
    const name = args[i].slice(2);
    if (BOOLEAN_FLAGS.has(name)) flags[name] = true;
    else {
      if (args[i + 1] === undefined) throw new Error(`--${name} needs a value`);
      flags[name] = args[++i];
    }
  }
  return flags;
}

/** The four art URIs: --art fills any slot its own flag leaves empty. */
function artFromFlags(flags) {
  const slots = { pngRegular: 'art-png', pngShiny: 'art-shiny', gifRegular: 'art-gif', gifShiny: 'art-gif-shiny' };
  const art = {};
  for (const [slot, flag] of Object.entries(slots)) {
    const path = flags[flag] ?? flags.art;
    if (!path) throw new Error(`no art for ${slot}: pass --${flag}, or --art to fill every empty slot`);
    art[slot] = artDataUri(path);
  }
  return art;
}

function artWarnings(art) {
  const warnings = [];
  if (!art.gifRegular.startsWith('data:image/gif') || !art.gifShiny.startsWith('data:image/gif')) {
    warnings.push('A GIF slot holds a non-GIF image, so presets 2 and 3 will not animate.');
  }
  if (art.pngRegular === art.pngShiny || art.gifRegular === art.gifShiny) {
    warnings.push('Regular and shiny art are the same file, so shiny presets will look identical.');
  }
  return warnings;
}

/** Everything the simulate and preview commands share: the calls, in send order. */
async function planFromFlags(flags, url, network) {
  const { registry, nft, soundManager } = ADDRESSES[network];
  const manager = flags['sound-manager'] === 'originals' ? soundManager : flags['sound-manager'];
  if (!manager && (flags['copy-track-from'] || flags.inputs || flags.named)) {
    throw new Error('--copy-track-from, --inputs and --named need --sound-manager');
  }
  if (flags['copy-track-from'] && flags.inputs) throw new Error('use --copy-track-from or --inputs, not both');
  const [, nextCommunityId] = await call(url, registry, 'get_species_id_cursors');
  const art = artFromFlags(flags);
  const calls = [
    registerWithArtCall({
      registry, name: flags.name, beastType: Number(flags.type ?? 1), tier: Number(flags.tier ?? 3),
      minter: flags.account, speciesOwner: flags.account, art,
      royaltyBps: Number(flags['royalty-bps'] ?? 0), description: flags.description ?? '',
      soundManager: manager ?? '0x0',
    }),
    mintCall({
      nft, to: flags.account, speciesId: nextCommunityId, prefix: BigInt(flags.prefix ?? 1), suffix: BigInt(flags.suffix ?? 1),
      level: Number(flags.level ?? 5), health: Number(flags.health ?? 100), effects: Number(flags.effects ?? 0),
    }),
  ];
  let inputs = null;
  if (flags['copy-track-from']) {
    const [fromSpecies, sharedId] = flags['copy-track-from'].split(':');
    inputs = await readSharedTrackInputs(url, manager, fromSpecies, sharedId ?? 0);
  } else if (flags.inputs) {
    inputs = composerInputsCalldata(JSON.parse(readFileSync(flags.inputs, 'utf8')), nextCommunityId);
  }
  if (inputs) calls.push(addSharedTrackCall({ manager, speciesId: nextCommunityId, inputs }));
  return { calls, art, manager, speciesId: nextCommunityId, hasTrack: Boolean(inputs) };
}

const summarise = (plan) => ({
  soundManager: plan.manager ?? null,
  addedSharedTrack: plan.hasTrack,
  artUriBytes: Object.fromEntries(Object.entries(plan.art).map(([slot, uri]) => [slot, uri.length])),
  warnings: artWarnings(plan.art),
});

/** Registers, mints and renders inside simulations, so nothing is sent. The ID stamps block and minute, so it pins a block and retries if one moves on. */
async function preview(flags, url, network) {
  const { nft } = ADDRESSES[network];
  const plan = await planFromFlags(flags, url, network);
  for (let attempt = 0; ; attempt++) {
    const blockId = { block_number: await rpc(url, 'starknet_blockNumber', []) };
    const first = splitExecuteResult((await simulate(url, flags.account, plan.calls, blockId)).retdata);
    const tokenId = BigInt(first[1][0]);
    const extra = flags.named ? [selectNamedSongCall({ manager: plan.manager, tokenId })] : [];
    try {
      const fee = (await simulate(url, flags.account, [...plan.calls, ...extra], blockId)).feeFri;
      const rendered = await simulate(url, flags.account, [...plan.calls, ...extra, viewCall(nft, 'token_uri', tokenIdToU256(tokenId))], blockId);
      const { metadata, uri } = parseTokenUri(splitExecuteResult(rendered.retdata).at(-1));
      const saved = flags.out ? saveMetadata(metadata, flags.out) : [];
      return {
        ok: true, sent: false, speciesId: BigInt(first[0][0]).toString(), mintedTokenId: first[1][0], name: metadata.name,
        ...summarise(plan), hasPlayer: Boolean(metadata.animation_url), uriBytes: uri.length,
        estimatedFeeStrk: Number(fee) / 1e18, out: flags.out ?? null, saved,
      };
    } catch (error) {
      if (attempt >= 5 || !/invalid token ID/.test(error.message)) throw error;
    }
  }
}

/** Composes inputs with preview_inputs, a free view, and saves the MIDI. No species needed. */
async function audition(flags, url, network) {
  const { registry, soundManager } = ADDRESSES[network];
  const [, nextCommunityId] = await call(url, registry, 'get_species_id_cursors');
  const inputs = composerInputsCalldata(JSON.parse(readFileSync(flags.inputs, 'utf8')), nextCommunityId);
  const mode = { live: [0], original: [1] }[flags.mode ?? 'original'] ?? [2, flags.mode];
  // A song can't be heard before its birth block, or within a few blocks of the chain head, so default to a birth that allows both.
  const birthBlock = flags['birth-block'] ?? (mode[0] === 2 ? mode[1] : BigInt(await rpc(url, 'starknet_blockNumber', [])) - 100n);
  const felts = await call(url, soundManager, 'preview_inputs', [...inputs, flags.effects ?? 0, birthBlock, flags['name-variant'] ?? 0, ...mode]);
  const midi = decodeByteArrayBytes(felts);
  if (flags.out) writeFileSync(flags.out, midi);
  return { ok: true, sent: false, returnedFelts: felts.length, midiBytes: midi.length, saved: flags.out ?? null };
}

const USAGE = `usage:
  node species-calls.mjs simulate --account 0x... --name "Moss Golem" <art> [options]
  node species-calls.mjs preview  --account 0x... --name "Moss Golem" <art> [options] --out ./preview
  node species-calls.mjs audition --inputs song.json [--effects n] [--mode original|live|<block>] [--birth-block n] [--name-variant n] [--out song.mid]
art:     --art <file> fills every slot; --art-png, --art-shiny, --art-gif, --art-gif-shiny set one each
options: --tier --type --royalty-bps --description --network --rpc
         --prefix --suffix --level --health --effects
         --sound-manager originals|0x... with --copy-track-from <speciesId>:<sharedId> or --inputs song.json, and --named`;

async function main(argv) {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  const needsSpecies = command === 'simulate' || command === 'preview';
  if ((needsSpecies && (!flags.account || !flags.name)) || (command === 'audition' && !flags.inputs) || !(needsSpecies || command === 'audition')) {
    console.error(USAGE);
    process.exit(2);
  }
  const network = flags.network ?? 'sepolia';
  const url = flags.rpc ?? process.env.BEASTS_RPC_URL ?? DEFAULT_RPC[network];
  let result;
  if (command === 'audition') result = await audition(flags, url, network);
  else if (command === 'preview') result = await preview(flags, url, network);
  else {
    if (flags.named) throw new Error('--named needs the minted ID, so it runs with preview only');
    const plan = await planFromFlags(flags, url, network);
    const { retdata, feeFri } = await simulate(url, flags.account, plan.calls);
    const results = splitExecuteResult(retdata);
    result = {
      ok: true, sent: false, speciesId: BigInt(results[0][0]).toString(), mintedTokenId: results[1][0],
      ...summarise(plan), estimatedFeeStrk: Number(feeFri) / 1e18,
    };
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
