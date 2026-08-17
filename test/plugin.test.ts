import { afterAll, describe, it, expect } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import faviconPwa from '../src/index';
import { GENERATED_ASSET_NAMES } from '../src/generate';
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

const linkTags = (html: string) => html.match(/<link[^>]*>/g) ?? [];
const pluginLinks = (html: string) => linkTags(html).filter((tag) => tag.includes(DIR));
const manifestLink = (html: string) => pluginLinks(html).find((tag) => tag.includes('rel="manifest"')) ?? '';

const projects: string[] = [];

afterAll(() => {
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

// Match Vite's native path canonicalization. This resolves macOS's /var
// symlink and preserves the Windows path identity Rolldown uses for HTML inputs.
function createProject(prefix: string): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  projects.push(root);
  return root;
}

type ConfigCase = {
  publicDirName?: string | null;
  ssr?: boolean;
  command?: 'build' | 'serve';
  copyPublicDir?: boolean;
  publicDirs?: string[];
};

function resolveConfig(
  options: Omit<FaviconsOptions, 'name'>,
  publicFiles: string[],
  { publicDirName = 'public', ssr = false, command = 'build', copyPublicDir = true, publicDirs = [] }: ConfigCase = {},
) {
  const root = createProject('vfp-public-');
  const publicDir = publicDirName ? join(root, publicDirName) : '';
  if (publicDir) {
    mkdirSync(publicDir, { recursive: true });
    for (const name of publicFiles) writeFileSync(join(publicDir, name), 'x');
    for (const name of publicDirs) mkdirSync(join(publicDir, name), { recursive: true });
  }

  const warnings: string[] = [];
  const plugin = faviconPwa({ name: 'Fixture App', source: 'logo.svg', ...options });
  (plugin.configResolved as (c: unknown) => void)({
    root,
    base: '/',
    command,
    publicDir,
    build: { outDir: 'dist', copyPublicDir, ...(ssr ? { ssr: 'entry.js' } : {}) },
    logger: { warn: (message: string) => warnings.push(message) },
  });
  return { root, publicDir, warnings };
}

async function buildFixture(base: string, options: FaviconsOptions, assetsDir = DIR) {
  const root = createProject('vfp-');
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

  const read = (name: string) => readFileSync(join(outDir, assetsDir, name), 'utf8');
  return {
    outDir,
    assetDir: join(outDir, assetsDir),
    html: readFileSync(join(outDir, 'index.html'), 'utf8'),
    svg: read('favicon.svg'),
    manifest: JSON.parse(read('manifest.webmanifest')),
  };
}

const PAGES = ['index.html', 'nested/index.html', 'docs/guides/index.html'];

async function buildMultipage(base: string, options: FaviconsOptions) {
  const root = createProject('vfp-mpa-');
  writeFileSync(join(root, 'logo.svg'), SOURCE_SVG);
  for (const page of PAGES) {
    mkdirSync(join(root, dirname(page)), { recursive: true });
    writeFileSync(join(root, page), INDEX_HTML);
  }

  const outDir = join(root, 'dist');
  await build({
    root,
    base,
    logLevel: 'silent',
    configFile: false,
    plugins: [faviconPwa({ source: 'logo.svg', ...options })],
    build: {
      outDir,
      emptyOutDir: true,
      reportCompressedSize: false,
      rollupOptions: { input: Object.fromEntries(PAGES.map((page) => [page, join(root, page)])) },
    },
  });

  return Object.fromEntries(PAGES.map((page) => [page, readFileSync(join(outDir, page), 'utf8')]));
}

const hrefs = (html: string) =>
  linkTags(html)
    .filter((tag) => /rel="(?:icon|apple-touch-icon|manifest)"/.test(tag))
    .map((tag) => tag.match(/href="([^"]*)"/)?.[1] ?? '');

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
    for (const outDir of [
      '..',
      '../favicons',
      './favicons',
      'assets//favicons',
      'assets\\favicons',
      'assets/favicons?x',
      'assets favicons',
    ]) {
      expect(() => faviconPwa({ name: 'Fixture', outDir }), outDir).toThrow('"outDir"');
    }
  });

  it('accepts every spelling of the site root as the output directory', () => {
    for (const outDir of ['', '.', '/', './']) {
      expect(() => faviconPwa({ name: 'Fixture', outDir }), outDir).not.toThrow();
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
    const root = createProject('vfp-viewport-');
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
    const root = createProject('vfp-rebuild-');
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

  it('treats an explicitly undefined option as absent', async () => {
    const out = await buildFixture('/', {
      name: 'Fixture App',
      padding: undefined,
      radius: undefined,
      background: undefined,
      outDir: undefined,
      themeColor: undefined,
      lang: undefined,
      dir: undefined,
    });

    const omitted = await buildFixture('/', { name: 'Fixture App' });

    expect(out.svg).not.toContain('NaN');
    expect(out.svg).toBe(omitted.svg);
    expect(out.manifest).toEqual(omitted.manifest);
  }, 30000);

  it('rejects a manifest crossorigin value the CORS settings attribute does not define', () => {
    expect(() =>
      faviconPwa({ name: 'Fixture', manifestCrossOrigin: 'credentials' as never }),
    ).toThrow('"manifestCrossOrigin"');
  });

  it('omits crossorigin on the manifest link by default', async () => {
    const out = await buildFixture('/', { name: 'Fixture App' });

    expect(manifestLink(out.html)).not.toBe('');
    expect(manifestLink(out.html)).not.toContain('crossorigin');
  }, 30000);

  it('carries credentials to a cookie-authed manifest when asked', async () => {
    const out = await buildFixture('https://cdn.example.com/static/', {
      name: 'Fixture App',
      manifestCrossOrigin: 'use-credentials',
    });

    expect(manifestLink(out.html)).toContain('crossorigin="use-credentials"');
    expect(pluginLinks(out.html).filter((tag) => tag.includes('crossorigin'))).toHaveLength(1);
  }, 30000);

  it('emits the asset set at the site root with root-relative hrefs', async () => {
    const out = await buildFixture('/', { name: 'Fixture App', outDir: '' }, '');

    expect([...readdirSync(out.outDir)].sort()).toEqual([...ASSET_NAMES, 'index.html'].sort());
    expect([...GENERATED_ASSET_NAMES].sort()).toEqual([...ASSET_NAMES].sort());

    expect(hrefs(out.html)).toEqual([
      '/favicon.ico',
      '/favicon.svg',
      '/apple-touch-icon.png',
      '/manifest.webmanifest',
    ]);
    expect(out.manifest.id).toBe('/');
    expect(out.manifest.start_url).toBe('/');
    expect(out.manifest.scope).toBe('/');
    expect(out.manifest.icons[0].src).toBe('pwa-192x192.png');
  }, 30000);

  it('resolves root output under an absolute subpath base', async () => {
    const out = await buildFixture('/subpath/', { name: 'Fixture App', outDir: '/' }, '');

    expect(hrefs(out.html)).toEqual([
      '/subpath/favicon.ico',
      '/subpath/favicon.svg',
      '/subpath/apple-touch-icon.png',
      '/subpath/manifest.webmanifest',
    ]);
    expect(out.manifest.start_url).toBe('/subpath/');
  }, 30000);

  it('keeps root output document-relative under a relative base', async () => {
    const out = await buildFixture('./', { name: 'Fixture App', outDir: '.' }, '');

    expect(hrefs(out.html)).toEqual([
      './favicon.ico',
      './favicon.svg',
      './apple-touch-icon.png',
      './manifest.webmanifest',
    ]);
    expect(out.manifest.id).toBe('./');
    expect(out.manifest.start_url).toBe('./');
    expect(out.manifest.scope).toBe('./');
  }, 30000);

  it('keeps root output document-relative under an empty base, which Vite resolves to "./"', async () => {
    const out = await buildFixture('', { name: 'Fixture App', outDir: './' }, '');

    expect(hrefs(out.html)).toEqual([
      './favicon.ico',
      './favicon.svg',
      './apple-touch-icon.png',
      './manifest.webmanifest',
    ]);
    expect(out.manifest.start_url).toBe('./');
  }, 30000);

  it('walks each nested entry back to root output under a relative base', async () => {
    const pages = await buildMultipage('./', { name: 'Fixture App', outDir: '/' });

    expect(hrefs(pages['index.html'])).toEqual([
      './favicon.ico',
      './favicon.svg',
      './apple-touch-icon.png',
      './manifest.webmanifest',
    ]);
    expect(hrefs(pages['nested/index.html'])).toEqual([
      '../favicon.ico',
      '../favicon.svg',
      '../apple-touch-icon.png',
      '../manifest.webmanifest',
    ]);
    expect(hrefs(pages['docs/guides/index.html'])).toEqual([
      '../../favicon.ico',
      '../../favicon.svg',
      '../../apple-touch-icon.png',
      '../../manifest.webmanifest',
    ]);
  }, 30000);

  it('walks each nested entry back to the asset folder under an empty base', async () => {
    const pages = await buildMultipage('', { name: 'Fixture App' });

    expect(hrefs(pages['index.html'])).toEqual([
      './assets/favicons/favicon.ico',
      './assets/favicons/favicon.svg',
      './assets/favicons/apple-touch-icon.png',
      './assets/favicons/manifest.webmanifest',
    ]);
    expect(hrefs(pages['nested/index.html'])).toEqual([
      '../assets/favicons/favicon.ico',
      '../assets/favicons/favicon.svg',
      '../assets/favicons/apple-touch-icon.png',
      '../assets/favicons/manifest.webmanifest',
    ]);
    expect(hrefs(pages['docs/guides/index.html'])).toEqual([
      '../../assets/favicons/favicon.ico',
      '../../assets/favicons/favicon.svg',
      '../../assets/favicons/apple-touch-icon.png',
      '../../assets/favicons/manifest.webmanifest',
    ]);
  }, 30000);

  it('keeps every nested entry on the same href under absolute and CDN bases', async () => {
    const subpath = await buildMultipage('/subpath/', { name: 'Fixture App', outDir: '/' });
    for (const page of PAGES) {
      expect(hrefs(subpath[page]), page).toEqual([
        '/subpath/favicon.ico',
        '/subpath/favicon.svg',
        '/subpath/apple-touch-icon.png',
        '/subpath/manifest.webmanifest',
      ]);
    }

    const cdn = await buildMultipage('https://cdn.example.com/static/', { name: 'Fixture App' });
    for (const page of PAGES) {
      expect(hrefs(cdn[page]), page).toEqual([
        'https://cdn.example.com/static/assets/favicons/favicon.ico',
        'https://cdn.example.com/static/assets/favicons/favicon.svg',
        'https://cdn.example.com/static/assets/favicons/apple-touch-icon.png',
        'https://cdn.example.com/static/assets/favicons/manifest.webmanifest',
      ]);
    }
  }, 60000);

  it('omits app navigation URLs for root output on a full-URL base', async () => {
    const out = await buildFixture('https://cdn.example.com/static/', { name: 'Fixture App', outDir: '' }, '');

    expect(hrefs(out.html)).toEqual([
      'https://cdn.example.com/static/favicon.ico',
      'https://cdn.example.com/static/favicon.svg',
      'https://cdn.example.com/static/apple-touch-icon.png',
      'https://cdn.example.com/static/manifest.webmanifest',
    ]);
    expect(out.manifest).not.toHaveProperty('id');
    expect(out.manifest).not.toHaveProperty('start_url');
    expect(out.manifest).not.toHaveProperty('scope');
  }, 30000);

  it('warns when a public directory file collides with a generated asset at the site root', () => {
    const { root, publicDir, warnings } = resolveConfig({ outDir: '' }, ['favicon.svg', 'favicon.ico', 'mark.svg']);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"outDir"');
    expect(warnings[0]).toContain(join(root, 'dist'));
    expect(warnings[0]).toContain(join(publicDir, 'favicon.svg'));
    expect(warnings[0]).toContain(join(publicDir, 'favicon.ico'));
    expect(warnings[0]).not.toContain('mark.svg');
    expect(warnings[0]).not.toContain('case');
  });

  it('stays quiet about the public directory when the assets have their own folder', () => {
    expect(resolveConfig({ outDir: 'assets/favicons' }, ['favicon.svg']).warnings).toEqual([]);
    expect(resolveConfig({}, ['favicon.svg']).warnings).toEqual([]);
  });

  it('tells a build the generated set overwrites the public file, not that it is a toss-up', () => {
    const { root, warnings } = resolveConfig({ outDir: '' }, ['favicon.ico'], { command: 'build' });

    expect(warnings[0]).toContain('overwrit');
    expect(warnings[0]).toContain(join(root, 'dist'));
    expect(warnings[0]).not.toMatch(/not defined|write order/);
  });

  it('tells a build a public directory of the same name fails it, rather than being overwritten', () => {
    const { root, publicDir, warnings } = resolveConfig({ outDir: '' }, [], {
      command: 'build',
      publicDirs: ['favicon.ico'],
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('fails the build');
    expect(warnings[0]).toContain(join(publicDir, 'favicon.ico'));
    expect(warnings[0]).toContain(join(root, 'dist'));
    expect(warnings[0]).not.toContain('overwrites');
  });

  it('separates a blocking public directory from the files the build overwrites', () => {
    const { publicDir, warnings } = resolveConfig({ outDir: '' }, ['favicon.svg'], {
      command: 'build',
      publicDirs: ['favicon.ico'],
    });

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('fails the build');
    expect(warnings[0]).toContain(join(publicDir, 'favicon.ico'));
    expect(warnings[0]).not.toContain(join(publicDir, 'favicon.svg'));
    expect(warnings[1]).toContain('overwrites');
    expect(warnings[1]).toContain(join(publicDir, 'favicon.svg'));
    expect(warnings[1]).not.toContain(join(publicDir, 'favicon.ico'));
  });

  it('treats a public directory like a file in dev, where the middleware shadows either', () => {
    const { publicDir, warnings } = resolveConfig({ outDir: '' }, ['favicon.svg'], {
      command: 'serve',
      publicDirs: ['favicon.ico'],
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('dev server');
    expect(warnings[0]).toContain(join(publicDir, 'favicon.ico'));
    expect(warnings[0]).toContain(join(publicDir, 'favicon.svg'));
  });

  it('tells the dev server the generated set shadows the public file', () => {
    const { root, warnings } = resolveConfig({ outDir: '' }, ['favicon.ico'], { command: 'serve' });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('dev server');
    expect(warnings[0]).not.toContain(join(root, 'dist'));
  });

  it('stays quiet at build when the public directory is not copied', () => {
    expect(resolveConfig({ outDir: '' }, ['favicon.ico'], { command: 'build', copyPublicDir: false }).warnings).toEqual(
      [],
    );
  });

  it('still warns in dev when the public directory is not copied, since the copy is a build step', () => {
    expect(
      resolveConfig({ outDir: '' }, ['favicon.ico'], { command: 'serve', copyPublicDir: false }).warnings,
    ).toHaveLength(1);
  });

  it('warns for a public directory file that differs only in case', () => {
    const { publicDir, warnings } = resolveConfig({ outDir: '' }, ['Favicon.ICO']);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(join(publicDir, 'Favicon.ICO'));
    expect(warnings[0]).toContain('case');
  });

  it('stays quiet about the public directory during an SSR build, which emits nothing', () => {
    expect(resolveConfig({ outDir: '' }, ['favicon.svg'], { ssr: true }).warnings).toEqual([]);
  });

  it('stays quiet when no public directory file shares a generated name', () => {
    expect(resolveConfig({ outDir: '' }, ['mark.svg', 'robots.txt']).warnings).toEqual([]);
    expect(resolveConfig({ outDir: '' }, []).warnings).toEqual([]);
    expect(resolveConfig({ outDir: '' }, ['favicon.svg'], { publicDirName: null }).warnings).toEqual([]);
  });

  it('does not generate or emit browser assets during an SSR build', async () => {
    const root = createProject('vfp-ssr-');
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
