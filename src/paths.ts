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
  const localBase = `/${dir}/`;
  return url.startsWith(localBase) ? url.slice(localBase.length) : null;
}
