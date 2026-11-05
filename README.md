# MOB Arena

A game on **Beasts (Musical Onchain Beasts)** — the onchain art + music NFTs on Starknet.
Pick any two live Beasts and fight them. Stats come from the token ID itself, art and
music come from the chain, no wallet needed to play.

## Run

```sh
npm install
python3 -m http.server 8899
# open http://localhost:8899
```

Or deploy the folder as-is to any static host (Cloudflare Pages, Netlify, GitHub Pages).
No build step. No API keys. The browser talks to public Starknet RPCs directly.

## How it works

| Piece | Where | What it does |
| --- | --- | --- |
| `src/engine.mjs` | pure functions | Battle rules: power, type advantage, turn order |
| `src/chain.mjs` | browser | Reads species, token IDs, metadata from Starknet |
| `index.html` | browser | The arena UI |
| `art/prepare.mjs` | Node | Turns a photo into the four art slots a species needs |
| `launch/register.mjs` | Node | Registers a species, adds a song, mints one Beast |

**Battle rules.** Power is `level * (6 - tier)`, capped at 65535. Each hit deals
2% of power, ×1.5 on a type advantage, ×0.75 on a disadvantage. Magic beats Hunter,
Hunter beats Brute, Brute beats Magic. Higher level strikes first; a Beast at 0 health
doesn't hit back. No randomness, so any fight is reproducible.

**Token IDs are the stats.** A Beast's 251-bit token ID encodes species, tier, type,
level, health, prefix, suffix, mint block and condition. `src/chain.mjs` decodes it
offline — no RPC needed to know what a Beast can do.

**Two RPCs, because no one endpoint serves everything.** PublicNode handles ordinary
reads and transactions, but reverts `token_uri` with `Out of gas`. Zan serves `token_uri`.
The app uses each for what it can do.

## Art

```sh
node art/prepare.mjs ~/Downloads/photo.jpg --out art/out --song art/song.json
```

Registration stores four data URIs verbatim as calldata, so size is cost: each byte is
about 1/31 of a felt, and a transaction caps at 10,000 felts total. The pipeline lands at
80×80 with 10 colours — roughly 2,600 bytes per PNG and 7,000 per GIF, all four slots
together well under the ceiling.

Slots: PNG regular, PNG shiny, GIF regular, GIF shiny. Preset 1 and 3 render the shiny
PNG, presets 2 and 3 play the GIFs.

## Mint your own

```sh
ACCOUNT=0x... PRIVATE_KEY=0x... node launch/register.mjs --name "Moss Golem" --song art/song.json
```

Registration is open on Sepolia. The script reads the species ID from the real receipt
and the token ID from the chain — never from a cursor, which may have moved.

## Tests

```sh
npm test          # 16 tests: engine rules + token-ID codec
node --test scripts/token-id.test.mjs   # 90 vectors from the Beasts skill
```

## Notes

- Beasts source isn't public and there's no SDK on npm. Everything here reads the
  deployed contracts directly.
- Sepolia is the practice network. The same classes run on mainnet with different
  addresses — change `network` in `src/chain.mjs` and `launch/register.mjs`.
- Species 1-75 can't be minted by the public; community species start at 10001.
