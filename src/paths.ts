import { posix } from 'node:path';

// Normalize outDir to a bare Rollup file-name prefix: "" for the site root,
// otherwise a relative path with no surrounding slashes. Every spelling of the
// root ("", ".", "/", "./") collapses to "" so callers branch on one value.
export function normalizeOutDir(outDir: string): string {
  const dir = outDir.replace(/^\/+|\/+$/g, '');
  if (dir === '' || dir === '.') return '';
  const segments = dir.split('/');
  if (
    outDir.includes('\\') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..' || !/^[a-zA-Z0-9._~-]+$/.test(segment))
  ) {
    throw new TypeError(
      'vite-plugin-favicon-pwa: "outDir" must be the site root ("", ".", "/", or "./") or a URL-safe relative directory without "." or ".." segments.',
    );
  }
  return dir;
}

// Concatenating `${viteBase}${dir}/` unconditionally yields "//" at the site
// root, which a browser reads as protocol-relative and resolves to
// http://favicon.ico. At the root the prefix is Vite's base verbatim.
export function assetBase(viteBase: string, dir: string): string {
  return dir ? `${viteBase}${dir}/` : viteBase;
}

// `htmlPath` is Vite's transformIndexHtml `ctx.path`, a root-relative URL path
// (e.g. "/docs/guides/index.html") rather than a filesystem path, so the posix
// flavour of node:path is required on every platform, Windows included.
export function assetBaseForHtml(viteBase: string, dir: string, htmlPath: string): string {
  const relativeBase = viteBase === '' || viteBase === './';
  if (!relativeBase) return assetBase(viteBase, dir);
  const from = posix.dirname(htmlPath.startsWith('/') ? htmlPath : `/${htmlPath}`);
  const relative = posix.relative(from, dir ? `/${dir}` : '/');
  if (!relative) return './';
  const walksUp = relative === '..' || relative.startsWith('../');
  return walksUp ? `${relative}/` : `./${relative}/`;
}

// The manifest is emitted beside the icons inside `dir`, but its `id`,
// `start_url`, and `scope` must reference the app root, not the manifest's own
// directory. For an absolute path-style Vite base ("/", "/app/") the root is
// the base itself. For a relative base ("" or "./"), Vite emits everything
// relative to the HTML document and there is no absolute anchor, so the root is
// reached by stepping back out of `dir` by its segment depth (e.g.
// assets/favicons -> ../../).
//
// A full-URL base usually points at a CDN, not the application origin. Manifest
// navigation URLs resolve against the manifest URL and must match the document
// origin, which cannot be inferred at build time. Return undefined so those
// fields are omitted and the user agent falls back to the installing document.
// Icons remain manifest-relative and may be served by the CDN.
//
// `dir` is expected without leading/trailing slashes (e.g. "assets/favicons").
export function manifestAppRoot(viteBase: string, dir: string, appRoot?: string): string | undefined {
  if (appRoot) return appRoot;
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(viteBase)) return undefined;
  const relative = viteBase === '' || viteBase.startsWith('.');
  if (!relative) return viteBase;
  const depth = dir.split('/').filter(Boolean).length;
  return depth ? '../'.repeat(depth) : './';
}

// Resolve a dev-server request URL to the bare asset name it targets (e.g.
// "favicon.ico"), or null if it isn't one of our assets. An absolute subpath
// base ("/app/") is stripped first so matching works under a subpath as well as
// at the root. The strip is guarded to absolute, non-root bases: a relative or
// empty base is left as-is (the dev server always serves from the root), which
// also avoids treating "" as a prefix of every URL.
export function resolveAssetName(rawUrl: string, viteBase: string, dir: string): string | null {
  let url = rawUrl.split('?')[0];
  if (viteBase.startsWith('/') && viteBase !== '/' && url.startsWith(viteBase)) {
    url = '/' + url.slice(viteBase.length);
  }
  const localBase = dir ? `/${dir}/` : '/';
  if (!url.startsWith(localBase)) return null;
  const name = url.slice(localBase.length);
  // One segment only. At the site root localBase is "/", so this is what keeps
  // the function's "or null if it isn't one of our assets" contract honest on
  // its own, independent of the caller's generated-set check.
  return name && !name.includes('/') ? name : null;
}
