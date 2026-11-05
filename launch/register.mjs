// Registers a species, adds a song, mints one Beast, on Sepolia.
//   ACCOUNT=0x... PRIVATE_KEY=0x... node launch/register.mjs --name "Moss Golem" [--dry-run]
//
// Reads the species ID from the real receipt (never from the cursor, which may have moved),
// then reads the minted token ID from the chain. Sends nothing with --dry-run: it builds the
// same calls and reports their fee estimate.

import { readFileSync } from 'node:fs';
import { Account, RpcProvider } from 'starknet';
import { ADDRESSES, call } from '../scripts/beasts-read.mjs';
import {
  addSharedTrackCall, artDataUri, composerInputsCalldata, mintCall, registerWithArtCall, speciesIdFromReceipt, splitExecuteResult,
} from '../scripts/species-calls.mjs';

const RPC = process.env.BEASTS_RPC_URL ?? 'https://starknet-sepolia-rpc.publicnode.com';
const NETWORK = process.env.BEASTS_NETWORK ?? 'sepolia';

function args(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return flags;
}

export async function launch({ name, art, songPath, prefix = 63, suffix = 4, level = 5, health = 100, effects = 2, account, privateKey, dryRun = false }) {
  const provider = new RpcProvider({ nodeUrl: RPC });
  const { registry, nft, soundManager } = ADDRESSES[NETWORK];
  const who = account ?? process.env.ACCOUNT;
  const key = privateKey ?? process.env.PRIVATE_KEY;
  if (!who) throw new Error('ACCOUNT is required');
  const signer = key ? new Account({ provider, address: who, signer: key }) : null;

  const register = registerWithArtCall({
    registry, name, beastType: Number(1), tier: Number(3), minter: who, speciesOwner: who, art, soundManager,
  });
  const inputs = songPath ? composerInputsCalldata(JSON.parse(readFileSync(songPath, 'utf8')), 0) : null;

  if (dryRun) {
    return { sent: false, account: who, rpc: RPC, network: NETWORK, registerCalldata: register.calldata.length, hasSong: Boolean(inputs), note: 'no key or --dry-run: nothing sent' };
  }
  if (!signer) throw new Error('PRIVATE_KEY is required to send');

  const send = async (calls) => {
    const { transaction_hash } = await signer.execute(calls);
    return provider.waitForTransaction(transaction_hash);
  };

  // 1. Register alone, then take the species ID from the receipt.
  const receipt = await send([register]);
  const speciesId = speciesIdFromReceipt(receipt, registry);

  // 2. Add the song as the species default, and mint.
  const calls = [];
  if (inputs) calls.push(addSharedTrackCall({ manager: soundManager, speciesId, inputs }));
  calls.push(mintCall({ nft, to: who, speciesId, prefix: BigInt(prefix), suffix: BigInt(suffix), level, health, effects }));
  const mintReceipt = await send(calls);

  // 3. The mint's return value isn't exposed, so read the token ID.
  const [tokenId] = await call(RPC, nft, 'get_token_id_by_affixes', [speciesId, prefix, suffix]);
  return { sent: true, speciesId: speciesId.toString(), tokenId: tokenId.toString(), mintTx: mintReceipt.transaction_hash };
}

const USAGE = `usage: ACCOUNT=0x... PRIVATE_KEY=0x... node launch/register.mjs --name "Moss Golem" [--song art/song.json] [--dry-run]
  art comes from art/prepare.mjs; --art-png etc. are read from art/out by default`;

if (process.argv[1] && process.argv[1].endsWith('register.mjs')) {
  const flags = args(process.argv.slice(2));
  if (!flags.name) {
    console.error(USAGE);
    process.exit(2);
  }
  const art = flags.art
    ? { pngRegular: artDataUri(flags.art), pngShiny: artDataUri(flags.art), gifRegular: artDataUri(flags.art), gifShiny: artDataUri(flags.art) }
    : { pngRegular: artDataUri('art/out/regular.png'), pngShiny: artDataUri('art/out/shiny.png'), gifRegular: artDataUri('art/out/regular.gif'), gifShiny: artDataUri('art/out/shiny.gif') };
  launch({ name: flags.name, art, songPath: flags.song, prefix: flags.prefix ?? 63, suffix: flags.suffix ?? 4, dryRun: Boolean(flags['dry-run']) })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
