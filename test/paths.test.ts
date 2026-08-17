import { describe, it, expect } from 'vitest';
import { assetBase, assetBaseForHtml, manifestAppRoot, normalizeOutDir, resolveAssetName } from '../src/paths';

describe('normalizeOutDir', () => {
  it('keeps a URL-safe relative directory', () => {
    expect(normalizeOutDir('assets/favicons')).toBe('assets/favicons');
    expect(normalizeOutDir('favicons')).toBe('favicons');
    expect(normalizeOutDir('a.b_c~d-e')).toBe('a.b_c~d-e');
  });

  it('strips surrounding slashes', () => {
    expect(normalizeOutDir('/assets/favicons/')).toBe('assets/favicons');
  });

  it('normalizes every spelling of the site root to one value', () => {
    for (const spelling of ['', '.', '/', './']) {
      expect(normalizeOutDir(spelling), spelling).toBe('');
    }
  });

  it('rejects traversal, backslashes, and characters that are not URL-safe', () => {
    for (const outDir of [
      '..',
      '../x',
      'x/..',
      './assets',
      'assets/./favicons',
      'a\\b',
      'assets\\favicons',
      'a b',
      'assets//favicons',
      'assets/favicons?x',
      'assets/favi%20cons',
      'café',
    ]) {
      expect(() => normalizeOutDir(outDir), outDir).toThrow('"outDir"');
    }
  });
});

describe('assetBase', () => {
  it('prefixes the asset folder with Vite\'s base', () => {
    expect(assetBase('/', 'assets/favicons')).toBe('/assets/favicons/');
    expect(assetBase('/subpath/', 'assets/favicons')).toBe('/subpath/assets/favicons/');
    expect(assetBase('./', 'assets/favicons')).toBe('./assets/favicons/');
    expect(assetBase('', 'assets/favicons')).toBe('assets/favicons/');
    expect(assetBase('https://cdn.example.com/', 'assets/favicons')).toBe('https://cdn.example.com/assets/favicons/');
  });

  it('is the base itself when the assets sit at the site root', () => {
    expect(assetBase('/', '')).toBe('/');
    expect(assetBase('/subpath/', '')).toBe('/subpath/');
    expect(assetBase('./', '')).toBe('./');
    expect(assetBase('', '')).toBe('');
    expect(assetBase('https://cdn.example.com/', '')).toBe('https://cdn.example.com/');
  });

  it('never produces a protocol-relative prefix from a non-protocol-relative base', () => {
    for (const base of ['/', '/subpath/', './', '', 'https://cdn.example.com/']) {
      for (const dir of ['', 'assets/favicons']) {
        expect(assetBase(base, dir).startsWith('//'), `${base} + ${dir}`).toBe(false);
      }
    }
  });
});

describe('assetBaseForHtml', () => {
  it('steps back out of a nested document under a relative base', () => {
    expect(assetBaseForHtml('./', '', '/index.html')).toBe('./');
    expect(assetBaseForHtml('./', '', '/nested/index.html')).toBe('../');
    expect(assetBaseForHtml('./', '', '/docs/guides/index.html')).toBe('../../');
    expect(assetBaseForHtml('', '', '/nested/index.html')).toBe('../');
  });

  it('steps back out of a nested document before entering the asset folder', () => {
    expect(assetBaseForHtml('./', 'assets/favicons', '/index.html')).toBe('./assets/favicons/');
    expect(assetBaseForHtml('./', 'assets/favicons', '/nested/index.html')).toBe('../assets/favicons/');
    expect(assetBaseForHtml('./', 'assets/favicons', '/docs/guides/index.html')).toBe('../../assets/favicons/');
    expect(assetBaseForHtml('', 'assets/favicons', '/nested/index.html')).toBe('../assets/favicons/');
  });

  it('ignores document depth for an absolute or full-URL base', () => {
    for (const base of ['/', '/subpath/', 'https://cdn.example.com/', '//cdn.example.com/']) {
      for (const dir of ['', 'assets/favicons']) {
        for (const path of ['/index.html', '/nested/index.html', '/docs/guides/index.html']) {
          expect(assetBaseForHtml(base, dir, path), `${base} + ${dir} + ${path}`).toBe(assetBase(base, dir));
        }
      }
    }
  });

  it('treats a document path without a leading slash as root-relative', () => {
    expect(assetBaseForHtml('./', '', 'nested/index.html')).toBe('../');
    expect(assetBaseForHtml('./', 'favicons', 'index.html')).toBe('./favicons/');
  });
});

describe('manifestAppRoot', () => {
  it('returns an absolute base unchanged', () => {
    expect(manifestAppRoot('/', 'assets/favicons')).toBe('/');
    expect(manifestAppRoot('/app/', 'assets/favicons')).toBe('/app/');
  });

  it('omits app-root navigation fields for full-URL CDN bases', () => {
    expect(manifestAppRoot('https://cdn.example.com/assets/', 'favicons')).toBeUndefined();
    expect(manifestAppRoot('//cdn.example.com/assets/', 'favicons')).toBeUndefined();
  });

  it('uses an explicit app root for full-URL CDN bases', () => {
    expect(manifestAppRoot('https://cdn.example.com/assets/', 'favicons', 'https://app.example.com/')).toBe(
      'https://app.example.com/',
    );
  });

  it('steps out of the asset folder for a "./" relative base', () => {
    expect(manifestAppRoot('./', 'assets/favicons')).toBe('../../');
  });

  it('treats an empty base as relative (not collapsed to root)', () => {
    expect(manifestAppRoot('', 'assets/favicons')).toBe('../../');
  });

  it('scales the step-back to the asset folder depth', () => {
    expect(manifestAppRoot('./', 'favicons')).toBe('../');
    expect(manifestAppRoot('./', 'a/b/c')).toBe('../../../');
  });

  it('resolves to the current directory when assets sit at the root', () => {
    expect(manifestAppRoot('./', '')).toBe('./');
    expect(manifestAppRoot('', '')).toBe('./');
  });

  it('returns an absolute base unchanged when assets sit at the root', () => {
    expect(manifestAppRoot('/', '')).toBe('/');
    expect(manifestAppRoot('/app/', '')).toBe('/app/');
  });

  it('omits app-root navigation fields for a full-URL base when assets sit at the root', () => {
    expect(manifestAppRoot('https://cdn.example.com/', '')).toBeUndefined();
  });
});

describe('resolveAssetName', () => {
  it('resolves an asset request at the root base', () => {
    expect(resolveAssetName('/assets/favicons/favicon.ico', '/', 'assets/favicons')).toBe('favicon.ico');
  });

  it('strips an absolute subpath base', () => {
    expect(resolveAssetName('/app/assets/favicons/favicon.svg', '/app/', 'assets/favicons')).toBe('favicon.svg');
  });

  it('handles an empty base without mangling the URL', () => {
    // Regression: startsWith('') is always true, which used to prepend a second
    // slash and miss the asset folder.
    expect(resolveAssetName('/assets/favicons/favicon.ico', '', 'assets/favicons')).toBe('favicon.ico');
  });

  it('handles a relative base', () => {
    expect(resolveAssetName('/assets/favicons/pwa-192x192.png', './', 'assets/favicons')).toBe('pwa-192x192.png');
  });

  it('ignores the query string', () => {
    expect(resolveAssetName('/assets/favicons/favicon.ico?v=2', '/', 'assets/favicons')).toBe('favicon.ico');
  });

  it('returns null for a non-asset request', () => {
    expect(resolveAssetName('/index.html', '/', 'assets/favicons')).toBeNull();
    expect(resolveAssetName('/assets/other/thing.png', '/', 'assets/favicons')).toBeNull();
  });

  it('returns null for a nested path below the asset folder', () => {
    expect(resolveAssetName('/assets/favicons/nested/favicon.ico', '/', 'assets/favicons')).toBeNull();
  });

  it('resolves a root-level asset request', () => {
    expect(resolveAssetName('/favicon.ico', '/', '')).toBe('favicon.ico');
    expect(resolveAssetName('/manifest.webmanifest', '', '')).toBe('manifest.webmanifest');
    expect(resolveAssetName('/favicon.svg?v=2', './', '')).toBe('favicon.svg');
  });

  it('strips an absolute subpath base for a root-level asset', () => {
    expect(resolveAssetName('/app/favicon.ico', '/app/', '')).toBe('favicon.ico');
  });

  it('returns null for a nested path when assets sit at the root', () => {
    expect(resolveAssetName('/assets/index-abc123.png', '/', '')).toBeNull();
    expect(resolveAssetName('/', '/', '')).toBeNull();
  });
});
