// MOB Arena art pipeline: a photo becomes the four slots a Beasts species needs.
//
//   node art/prepare.mjs <photo.jpg> [--out art/out] [--name "Moss Golem"]
//
// Registration stores four data URIs verbatim as calldata, so size is cost:
// each byte is ~1/31 of a felt and a transaction caps at 10,000 felts total.
// The sweet spot measured here is 80x80 with 8-10 colours: ~2,600 bytes per URI,
// all four slots together well under 10,000 felts.
//
// Slots: PNG regular, PNG shiny, GIF regular, GIF shiny.
//   regular -> the art, posterized and contrast-boosted
//   shiny   -> the same art brightened, so presets 1 and 3 read as a foil
//   gif     -> two frames (scale pulse, brightness pulse) so presets 2 and 3 animate

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const ART_SIZE = 80;
export const ART_COLORS = 10;

function magick(args) {
  execFileSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

/** Squares a photo by center-cropping, then resizes. */
function square(src, dest, size) {
  magick([src, '-gravity', 'center', '-crop', `${size}x${size}+0+0`, '+repage', '-resize', `${size}x${size}`, dest]);
}

/** Posterize + contrast + palette quantization: the stylized Beast look at a fixed byte budget. */
function stylize(src, dest, { size = ART_SIZE, colors = ART_COLORS, modulate = '100,150' } = {}) {
  magick([src, '-resize', `${size}x${size}`, '-posterize', '6', '-modulate', modulate,
    '-colors', String(colors), '-type', 'Palette', '-define', 'png:compression-level=9', '-strip', dest]);
}

/** Two-frame GIF: art, then the same art zoomed in slightly. */
function pulseGif(src, dest, { size = ART_SIZE, colors = ART_COLORS } = {}) {
  const tmp = join(tmpdir(), `mob-arena-${process.pid}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  magick([src, '-resize', `${size}x${size}`, '-posterize', '6', '-modulate', '100,150',
    '-colors', String(colors), '-type', 'Palette', join(tmp, 'a.png')]);
  magick([src, '-gravity', 'center', '-crop', '85%x85%+0+0', '+repage', '-resize', `${size}x${size}`,
    '-posterize', '6', '-modulate', '100,150', '-colors', String(colors), '-type', 'Palette', join(tmp, 'b.png')]);
  magick(['-delay', '25', '-loop', '0', join(tmp, 'a.png'), join(tmp, 'b.png'), dest]);
  rmSync(tmp, { recursive: true, force: true });
  return dest;
}

/** Two-frame GIF: art, then the same art brightened. */
function shimmerGif(src, dest, { size = ART_SIZE, colors = ART_COLORS } = {}) {
  const tmp = join(tmpdir(), `mob-arena-${process.pid}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  magick([src, '-resize', `${size}x${size}`, '-posterize', '6', '-modulate', '100,150',
    '-colors', String(colors), '-type', 'Palette', join(tmp, 'a.png')]);
  magick([src, '-resize', `${size}x${size}`, '-posterize', '6', '-modulate', '135,180',
    '-colors', String(colors), '-type', 'Palette', join(tmp, 'b.png')]);
  magick(['-delay', '20', '-loop', '0', join(tmp, 'a.png'), join(tmp, 'b.png'), dest]);
  rmSync(tmp, { recursive: true, force: true });
  return dest;
}

function dataUri(path) {
  const ext = path.split('.').pop().toLowerCase();
  const mime = { png: 'image/png', gif: 'image/gif' }[ext];
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

/** Builds all four slots. Returns the art map plus exact byte sizes. */
export function prepareArt(src, outDir = 'art/out', options = {}) {
  mkdirSync(outDir, { recursive: true });
  const squarePath = join(outDir, 'square.png');
  square(src, squarePath, Math.max(ART_SIZE * 2, 256));

  const regular = join(outDir, 'regular.png');
  const shiny = join(outDir, 'shiny.png');
  stylize(squarePath, regular, options);
  stylize(squarePath, shiny, { ...options, modulate: '125,185' });

  const gifRegular = join(outDir, 'regular.gif');
  const gifShiny = join(outDir, 'shiny.gif');
  pulseGif(squarePath, gifRegular, options);
  shimmerGif(squarePath, gifShiny, options);

  const art = {
    pngRegular: dataUri(regular),
    pngShiny: dataUri(shiny),
    gifRegular: dataUri(gifRegular),
    gifShiny: dataUri(gifShiny),
  };
  const sizes = Object.fromEntries(Object.entries(art).map(([slot, uri]) => [slot, uri.length]));
  return { art, sizes, dir: outDir, files: { regular, shiny, gifRegular, gifShiny } };
}

/** Writes the song inputs the composer accepts. */
export function writeSongTemplate(path, speciesId = 10001) {
  const song = {
    song: {
      theme: { motif_seed: '0x4d6f7373', tier: 3, register_band: 1 },
      score: {
        mode_id: 8, tonic_keynum: 57, tier: 3, weakness: 2, voice_count: 4, section_count: 3,
        stretto_lag: 4, use_inversion: true, use_countersubject: true, ornament_density: 1,
        articulation_profile: 0, velocity_ceiling: 112, tempo_us: 428571,
      },
      treatment: {
        rhythm_seed: '0x4d6f7373', flip_side: false, development: 0, direction: 0,
        spacing: 1, trill: true, prominence: 2, section_rhythm: false,
      },
      arrangement: {
        family: 0, identity: { name_variant_id: 0, source_species_id: speciesId }, channel_count: 4,
        channel_policy: 'genesis', special: 'none', top_lead: true, balanced: true, weak_ties: true,
      },
    },
  };
  writeFileSync(path, JSON.stringify(song, null, 2));
  return song;
}

const USAGE = 'usage: node art/prepare.mjs <photo.jpg|png> [--out art/out] [--song art/song.json]';

if (process.argv[1] && process.argv[1].endsWith('prepare.mjs')) {
  const [src, ...rest] = process.argv.slice(2);
  if (!src || !existsSync(src)) {
    console.error(USAGE);
    process.exit(2);
  }
  const out = rest[0] === '--out' ? rest[1] : 'art/out';
  const result = prepareArt(src, out);
  if (rest.includes('--song')) {
    const at = rest.indexOf('--song');
    writeSongTemplate(rest[at + 1] ?? join(out, 'song.json'));
  }
  console.log(JSON.stringify({ sizes: result.sizes, dir: result.dir, total: Object.values(result.sizes).reduce((a, b) => a + b, 0) }, null, 2));
}
