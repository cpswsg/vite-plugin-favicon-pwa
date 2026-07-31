import { describe, it, expect } from 'vitest';
import { manifestAppRoot, resolveAssetName } from '../src/paths';

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
});
