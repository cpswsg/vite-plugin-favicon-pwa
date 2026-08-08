import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseViewBox, extractRootAttrs, stripInheritedFill, extractInner, recolorFills, squareSvg } from './svg.js';
import { manifestAppRoot } from './paths.js';
import type { ResolvedFaviconsOptions } from './options.js';

// Read the source SVG and return a fresh map (bare name -> contents) holding the
// full favicon + PWA set and the manifest. Returning a new map (rather than
// mutating a shared one) lets the caller commit only the newest run's result.
// Colour inputs are already normalised to sRGB by the caller. `viteBase` is
// Vite's public base and `dir` the asset folder; together they place the
// manifest's app-root URLs. Icons are referenced by bare filename, which is
// manifest-relative and correct under every base.
export async function generate(
  root: string,
  options: ResolvedFaviconsOptions,
  viteBase: string,
  dir: string,
): Promise<Map<string, Buffer | string>> {
  const raw = await readFile(resolve(root, options.source), 'utf8');

  const vb = parseViewBox(raw, options.source);
  let inner = extractInner(raw);
  let innerAttrs = extractRootAttrs(raw);
  if (options.foreground) {
    // Recolour explicit fills in the mark, and override any inherited root fill
    // so it can't win over the new colour.
    inner = recolorFills(inner, options.foreground);
    const rest = stripInheritedFill(innerAttrs);
    innerAttrs = rest ? `fill="${options.foreground}" ${rest}` : `fill="${options.foreground}"`;
  }

  const master = squareSvg({
    inner,
    vb,
    size: 512,
    background: options.background,
    padding: options.padding,
    innerAttrs,
    radius: options.radius,
  });
  const maskable = squareSvg({
    inner,
    vb,
    size: 512,
    background: options.background,
    padding: options.maskablePadding,
    innerAttrs,
  });
  // iOS applies its own squircle mask to the Apple touch icon and composites any
  // transparency onto black, so this one must be a full-bleed opaque square. The
  // `any` PWA icons keep the configured rounding: they are shown unmasked on
  // desktop taskbars and window chrome, where a full-bleed square looks unstyled.
  const appleIcon = squareSvg({
    inner,
    vb,
    size: 512,
    background: options.background,
    padding: options.padding,
    innerAttrs,
  });

  const [{ default: sharp }, { default: pngToIco }] = await Promise.all([import('sharp'), import('png-to-ico')]);

  const png = (svg: string, size: number) =>
    sharp(Buffer.from(svg), { density: 384 })
      .resize(size, size, { fit: 'contain' })
      .png({ compressionLevel: 9 })
      .toBuffer();

  const [ico16, ico32, ico48, apple, pwa192, pwa512, pwaMaskable] = await Promise.all([
    png(master, 16),
    png(master, 32),
    png(master, 48),
    png(appleIcon, 180),
    png(master, 192),
    png(master, 512),
    png(maskable, 512),
  ]);

  const appRoot = manifestAppRoot(viteBase, dir, options.appRoot);
  const manifest = {
    ...(appRoot ? { id: appRoot } : {}),
    name: options.name,
    short_name: options.shortName ?? options.name,
    ...(options.description ? { description: options.description } : {}),
    lang: options.lang,
    dir: options.dir,
    ...(appRoot ? { start_url: appRoot, scope: appRoot } : {}),
    display: 'standalone',
    background_color: options.background,
    theme_color: options.themeColor,
    icons: [
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };

  const assets = new Map<string, Buffer | string>();
  assets.set('favicon.svg', master);
  assets.set('favicon.ico', await pngToIco([ico16, ico32, ico48]));
  assets.set('apple-touch-icon.png', apple);
  assets.set('pwa-192x192.png', pwa192);
  assets.set('pwa-512x512.png', pwa512);
  assets.set('pwa-maskable-512x512.png', pwaMaskable);
  assets.set('manifest.webmanifest', JSON.stringify(manifest, null, 2));
  return assets;
}
