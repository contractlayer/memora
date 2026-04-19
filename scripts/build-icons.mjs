#!/usr/bin/env node
// Build Memora app icons from resources/logo.svg.
//
// Outputs:
//   resources/icons/icon.png   (1024×1024, used as tray/window icon fallback)
//   resources/icons/icon.ico   (Windows installer)
//   resources/icons/icon.icns  (macOS app bundle, via iconutil)
//   resources/icons/icon.iconset/  (intermediate, kept for inspection)

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svgPath = resolve(root, 'resources/logo.svg');
const outDir = resolve(root, 'resources/icons');
const iconsetDir = resolve(outDir, 'icon.iconset');

// macOS iconset sizes (name@1x + @2x each, per Apple spec).
const MAC_SIZES = [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
];

// Windows .ico embeds multiple sizes in one file. 16/24/32/48/64/128/256 is
// the standard set recognised by shell and installers.
const WIN_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function rasterize(svg, size, dst) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(dst);
}

async function main() {
  const svg = await readFile(svgPath);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(iconsetDir, { recursive: true });

  console.log('[icons] rasterizing base PNG 1024×1024');
  const iconPngPath = resolve(outDir, 'icon.png');
  await rasterize(svg, 1024, iconPngPath);

  console.log('[icons] building mac iconset');
  for (const { name, size } of MAC_SIZES) {
    await rasterize(svg, size, resolve(iconsetDir, name));
  }

  if (platform() === 'darwin') {
    console.log('[icons] iconutil → icon.icns');
    const result = spawnSync(
      'iconutil',
      ['-c', 'icns', '-o', resolve(outDir, 'icon.icns'), iconsetDir],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) {
      throw new Error(`iconutil failed with code ${result.status}`);
    }
  } else {
    console.warn('[icons] skipping .icns (iconutil is macOS-only)');
  }

  console.log('[icons] building Windows .ico');
  const winPngs = await Promise.all(
    WIN_SIZES.map(async (size) => {
      const buf = await sharp(svg, { density: 384 })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer();
      return buf;
    }),
  );
  const icoBuf = await pngToIco(winPngs);
  await writeFile(resolve(outDir, 'icon.ico'), icoBuf);

  console.log('[icons] done. Output in resources/icons/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
