import { afterAll, describe, it, expect } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import faviconPwa from '../src/index';
import type { FaviconsOptions } from '../src/index';

const SOURCE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#3366ff" fill-rule="evenodd" style="width:24px;height:24px">
  <path d="M2 2h20v20H2z"/>
  <circle cx="12" cy="12" r="5" fill="none"/>
</svg>`;

const INDEX_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fixture</title>
  </head>
  <body></body>
</html>`;

const DIR = 'assets/favicons';
const ASSET_NAMES = [
  'favicon.svg',
  'favicon.ico',
  'apple-touch-icon.png',
  'pwa-192x192.png',
  'pwa-512x512.png',
  'pwa-maskable-512x512.png',
  'manifest.webmanifest',
];

const projects: string[] = [];

afterAll(() => {
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

async function buildFixture(base: string, options: FaviconsOptions) {
  // realpathSync canonicalizes the macOS /var -> /private/var tmp symlink so
  // Vite's realpath-based html emit doesn't compute an escaping output path.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'vfp-')));
  projects.push(root);
  writeFileSync(join(root, 'logo.svg'), SOURCE_SVG);
  writeFileSync(join(root, 'index.html'), INDEX_HTML);

  const outDir = join(root, 'dist');
  await build({
    root,
    base,
    logLevel: 'silent',
    configFile: false,
    plugins: [faviconPwa({ source: 'logo.svg', ...options })],
    build: { outDir, emptyOutDir: true, reportCompressedSize: false },
  });

  const read = (name: string) => readFileSync(join(outDir, DIR, name), 'utf8');
  return {
    outDir,
    html: readFileSync(join(outDir, 'index.html'), 'utf8'),
    svg: read('favicon.svg'),
    manifest: JSON.parse(read('manifest.webmanifest')),
  };
}

describe('faviconPwa build', () => {
  it('requires a non-empty app name', () => {
    expect(() => faviconPwa({} as FaviconsOptions)).toThrow('"name" is required');
    expect(() => faviconPwa({ name: '   ' })).toThrow('"name" is required');
  });

  it('rejects numeric options that would produce invalid geometry', () => {
    expect(() => faviconPwa({ name: 'Fixture', padding: 0.5 })).toThrow('"padding"');
    expect(() => faviconPwa({ name: 'Fixture', maskablePadding: -0.1 })).toThrow('"maskablePadding"');
    expect(() => faviconPwa({ name: 'Fixture', radius: 0.51 })).toThrow('"radius"');
    expect(() => faviconPwa({ name: 'Fixture', radius: Number.NaN })).toThrow('"radius"');
  });

  it('rejects unsafe or ambiguous output directories', () => {
    for (const outDir of ['', '/', '.', '../favicons', 'assets//favicons', 'assets\\favicons', 'assets/favicons?x']) {
      expect(() => faviconPwa({ name: 'Fixture', outDir })).toThrow('"outDir"');
    }
  });

  it('emits the full asset set with absolute-base URLs and injects tags after viewport', async () => {
    const out = await buildFixture('/', { name: 'Fixture App', shortName: 'FA' });

    for (const name of ASSET_NAMES) {
      expect(existsSync(join(out.outDir, DIR, name)), `${name} emitted`).toBe(true);
    }

    // Manifest: app-root URLs are the absolute base; icons are bare (manifest-relative).
    expect(out.manifest.id).toBe('/');
    expect(out.manifest.start_url).toBe('/');
    expect(out.manifest.scope).toBe('/');
    expect(out.manifest.name).toBe('Fixture App');
    expect(out.manifest).not.toHaveProperty('description');
    expect(out.manifest.dir).toBe('auto');
    expect(out.manifest.icons.map((i: { src: string }) => i.src)).toEqual([
      'pwa-192x192.png',
      'pwa-512x512.png',
      'pwa-maskable-512x512.png',
    ]);

    // Root presentation attributes are preserved; inner fill:none survives.
    expect(out.svg).toContain('fill="#3366ff"');
    expect(out.svg).toContain('fill-rule="evenodd"');
    expect(out.svg).toContain('fill="none"');
    // Layout declarations in the root style are dropped so they can't override
    // the wrapper geometry.
    expect(out.svg).not.toContain('width:24px');

    // Tags injected immediately after the viewport meta, with absolute hrefs.
    expect(out.html).toContain('/assets/favicons/manifest.webmanifest');
    expect(out.html.indexOf('name="viewport"')).toBeLessThan(out.html.indexOf('rel="manifest"'));

    // iOS composites transparency onto black under its own squircle mask, so the
    // Apple touch icon must be a full-bleed opaque square.
    const cornerAlpha = async (name: string) => {
      const { data, info } = await sharp(join(out.outDir, DIR, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return [data[3], data[(info.width * info.height - 1) * 4 + 3]];
    };
    expect(await cornerAlpha('apple-touch-icon.png')).toEqual([255, 255]);

    // The `any` PWA icons keep the configured radius: desktop taskbars and window
    // chrome show them unmasked, so the rounding is the intended presentation.
    expect(await cornerAlpha('pwa-192x192.png')).toEqual([0, 0]);
    expect(await cornerAlpha('pwa-512x512.png')).toEqual([0, 0]);

    // The maskable icon is square by construction (no radius) for aggressive crops.
    expect(await cornerAlpha('pwa-maskable-512x512.png')).toEqual([255, 255]);
  }, 30000);

  it('finds viewport metadata regardless of quote style or attribute order', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'vfp-viewport-')));
    projects.push(root);
    writeFileSync(join(root, 'logo.svg'), SOURCE_SVG);
    writeFileSync(
      join(root, 'index.html'),
      '<!doctype html><html><head><meta content="width=device-width" name=\'viewport\'><title>x</title></head></html>',
    );

    const outDir = join(root, 'dist');
    await build({
      root,
      logLevel: 'silent',
      configFile: false,
      plugins: [faviconPwa({ name: 'Fixture App', source: 'logo.svg' })],
      build: { outDir, emptyOutDir: true, reportCompressedSize: false },
    });
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    expect(html.indexOf("name='viewport'")).toBeLessThan(html.indexOf('rel="manifest"'));
  }, 30000);

  it('regenerates when a plugin instance is reused for a later build', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'vfp-rebuild-')));
    projects.push(root);
    const source = join(root, 'logo.svg');
    writeFileSync(source, SOURCE_SVG.replace('#3366ff', '#ff0000'));
    writeFileSync(join(root, 'index.html'), INDEX_HTML);
    const plugin = faviconPwa({ name: 'Fixture App', source: 'logo.svg' });
    const outDir = join(root, 'dist');
    const config = {
      root,
      logLevel: 'silent' as const,
      configFile: false as const,
      plugins: [plugin],
      build: { outDir, emptyOutDir: true, reportCompressedSize: false },
    };

    await build(config);
    expect(readFileSync(join(outDir, DIR, 'favicon.svg'), 'utf8')).toContain('#ff0000');
    writeFileSync(source, SOURCE_SVG.replace('#3366ff', '#0000ff'));
    await build(config);
    const rebuilt = readFileSync(join(outDir, DIR, 'favicon.svg'), 'utf8');
    expect(rebuilt).toContain('#0000ff');
    expect(rebuilt).not.toContain('#ff0000');
  }, 30000);

  it('produces manifest-valid relative-base URLs and overrides the inherited root fill', async () => {
    const out = await buildFixture('./', { name: 'Fixture App', foreground: '#ff0000', dir: 'rtl' });

    // App-root steps out of assets/favicons; icons stay bare so they resolve
    // beside the manifest under a relative base.
    expect(out.manifest.id).toBe('../../');
    expect(out.manifest.start_url).toBe('../../');
    expect(out.manifest.scope).toBe('../../');
    expect(out.manifest.dir).toBe('rtl');
    expect(out.manifest.icons[0].src).toBe('pwa-192x192.png');

    // Foreground overrides the inherited root fill; inner fill:none still survives.
    expect(out.svg).toContain('fill="#ff0000"');
    expect(out.svg).not.toContain('#3366ff');
    expect(out.svg).toContain('fill="none"');

    // Injected manifest href is relative, not absolute.
    expect(out.html).toContain('assets/favicons/manifest.webmanifest');
    expect(out.html).not.toContain('"/assets/favicons/manifest.webmanifest');
  }, 30000);

  it('omits app navigation URLs when assets use a full-URL CDN base', async () => {
    const out = await buildFixture('https://cdn.example.com/static/', { name: 'Fixture App' });

    expect(out.manifest).not.toHaveProperty('id');
    expect(out.manifest).not.toHaveProperty('start_url');
    expect(out.manifest).not.toHaveProperty('scope');
    expect(out.html).toContain('https://cdn.example.com/static/assets/favicons/manifest.webmanifest');
  }, 30000);

  it('uses an explicit application root when assets use a CDN base', async () => {
    const out = await buildFixture('https://cdn.example.com/static/', {
      name: 'Fixture App',
      appRoot: 'https://app.example.com/',
    });

    expect(out.manifest.id).toBe('https://app.example.com/');
    expect(out.manifest.start_url).toBe('https://app.example.com/');
    expect(out.manifest.scope).toBe('https://app.example.com/');
  }, 30000);

  it('does not generate or emit browser assets during an SSR build', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'vfp-ssr-')));
    projects.push(root);
    writeFileSync(join(root, 'entry.js'), 'export const render = () => "ok";');

    const outDir = join(root, 'dist');
    await build({
      root,
      logLevel: 'silent',
      configFile: false,
      plugins: [faviconPwa({ name: 'Fixture App' })],
      build: { ssr: 'entry.js', outDir, emptyOutDir: true, reportCompressedSize: false },
    });

    expect(existsSync(join(outDir, DIR))).toBe(false);
  }, 30000);
});
