import { resolve, extname } from 'node:path';
import type { Plugin } from 'vite';
import { oklchToRgb } from './color.js';
import { generate } from './generate.js';
import { createAssetCoordinator } from './coordinator.js';
import { resolveAssetName } from './paths.js';
import { DEFAULTS, type FaviconsOptions } from './options.js';

export type { FaviconsOptions } from './options.js';

const MIME: Record<string, string> = {
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  png: 'image/png',
  webmanifest: 'application/manifest+json',
};

type Tag = { tag: string; attrs: Record<string, string> };

/**
 * Generates a full favicon + installable-PWA asset set from a single source
 * SVG (the logo mark), and injects the matching <link>/<meta> tags into
 * index.html. Runs in dev (served from memory via middleware) and build
 * (emitted into the bundle). No service worker - installable, not offline.
 *
 * The mark is centred on a square canvas with padding; foreground (mark) and
 * background are both configurable, so the logo can be recoloured per icon.
 * Asset URLs honour Vite's `base`, so subpath deploys resolve correctly.
 */
export default function faviconPwa(userOptions: FaviconsOptions): Plugin {
  if (!userOptions?.name?.trim()) {
    throw new TypeError('vite-plugin-favicon-pwa: "name" is required and must not be empty.');
  }

  const validateFraction = (key: 'padding' | 'maskablePadding' | 'radius', upperInclusive: boolean) => {
    const value = userOptions[key];
    if (value == null) return;
    const upperValid = upperInclusive ? value <= 0.5 : value < 0.5;
    if (!Number.isFinite(value) || value < 0 || !upperValid) {
      const range = upperInclusive ? 'between 0 and 0.5' : 'at least 0 and less than 0.5';
      throw new RangeError(`vite-plugin-favicon-pwa: "${key}" must be ${range}.`);
    }
  };
  validateFraction('padding', false);
  validateFraction('maskablePadding', false);
  validateFraction('radius', true);

  if (
    userOptions.manifestCrossOrigin != null &&
    userOptions.manifestCrossOrigin !== 'anonymous' &&
    userOptions.manifestCrossOrigin !== 'use-credentials'
  ) {
    throw new TypeError('vite-plugin-favicon-pwa: "manifestCrossOrigin" must be "anonymous" or "use-credentials".');
  }

  const options = { ...DEFAULTS, ...userOptions };
  // Normalise colour inputs so oklch() works everywhere sharp/the manifest read
  // them (resize background, SVG fills, theme colour). Hex/rgb/named pass through.
  options.background = oklchToRgb(options.background);
  options.themeColor = oklchToRgb(options.themeColor);
  if (options.foreground) options.foreground = oklchToRgb(options.foreground);

  // Output folder within the bundle, e.g. "assets/favicons". Keep this a
  // URL-safe Rollup file-name prefix: empty/root output and traversal segments
  // would otherwise create protocol-relative hrefs or escaping bundle paths.
  const dir = options.outDir.replace(/^\/+|\/+$/g, '');
  const segments = dir.split('/');
  if (
    !dir ||
    options.outDir.includes('\\') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..' || !/^[a-zA-Z0-9._~-]+$/.test(segment))
  ) {
    throw new TypeError(
      'vite-plugin-favicon-pwa: "outDir" must be a non-empty, URL-safe relative directory without "." or ".." segments.',
    );
  }

  let root = process.cwd();
  // Vite's public base path (e.g. "/", "/subpath/", or "./" / "" for a relative
  // build), resolved in configResolved.
  let viteBase = '/';
  let ssrBuild = false;
  // Public URL prefix for the asset <link> hrefs, incl. Vite's base so subpath
  // deploys resolve, e.g. "/subpath/assets/favicons/".
  let base = `/${dir}/`;
  let links: Tag[] = [];

  // Regenerate the asset set on demand; the coordinator commits only the newest
  // run, so a dev source-change can't be clobbered by a slower in-flight run.
  const coordinator = createAssetCoordinator(() => generate(root, options, viteBase, dir));

  // (Re)build the URL-dependent tags once Vite's base is known.
  const configure = () => {
    base = `${viteBase}${dir}/`;
    links = [
      { tag: 'link', attrs: { rel: 'icon', href: `${base}favicon.ico`, sizes: '16x16 32x32 48x48' } },
      { tag: 'link', attrs: { rel: 'icon', href: `${base}favicon.svg`, type: 'image/svg+xml' } },
      { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base}apple-touch-icon.png` } },
      {
        tag: 'link',
        attrs: {
          rel: 'manifest',
          href: `${base}manifest.webmanifest`,
          ...(options.manifestCrossOrigin ? { crossorigin: options.manifestCrossOrigin } : {}),
        },
      },
      { tag: 'meta', attrs: { name: 'theme-color', content: options.themeColor } },
      { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' } },
      { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
      { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: options.shortName ?? options.name } },
    ];
  };
  configure();

  // Escape a value for an HTML attribute (title/name may carry author text).
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Serialize a tag descriptor to its HTML string, so we can place the tags at
  // an exact position rather than letting Vite append them to the end of <head>.
  const renderTag = (t: Tag) =>
    `<${t.tag} ${Object.entries(t.attrs)
      .map(([k, v]) => `${k}="${esc(v)}"`)
      .join(' ')}/>`;
  // Find a viewport meta tag regardless of attribute order or quote style.
  const findViewport = (html: string) =>
    Array.from(html.matchAll(/<meta\b[^>]*>/gi)).find((match) =>
      /\bname\s*=\s*(?:"viewport"|'viewport'|viewport(?=\s|\/?>))/i.test(match[0]),
    );

  return {
    name: 'vite-plugin-favicon-pwa',
    configResolved(config) {
      root = config.root;
      // `?? '/'` rather than `|| '/'` so a relative base of "" is preserved
      // (and not collapsed to the absolute root).
      viteBase = config.base ?? '/';
      ssrBuild = Boolean(config.build.ssr);
      configure();
    },
    buildStart() {
      const isClient = typeof this.environment?.name === 'string' ? this.environment.name === 'client' : !ssrBuild;
      if (!isClient) return;
      coordinator.invalidate();
      return coordinator.ensure();
    },
    configureServer(server) {
      const srcPath = resolve(root, options.source);
      // Regenerate when the source SVG changes so dev never serves stale icons.
      server.watcher.add(srcPath);
      let reloadTimer: ReturnType<typeof setTimeout> | undefined;
      const sourceChanged = (file: string) => {
        if (file !== srcPath) return;
        coordinator.invalidate();
        clearTimeout(reloadTimer);
        // Collapse atomic saves and editor write bursts into one reload. Asset
        // invalidation remains immediate, while expensive regeneration starts on
        // the browser's single follow-up request.
        reloadTimer = setTimeout(() => server.ws.send({ type: 'full-reload' }), 25);
      };
      // Atomic-save editors commonly replace a file (unlink + add) rather than
      // changing it in place, so all source lifecycle events invalidate assets.
      server.watcher.on('add', sourceChanged);
      server.watcher.on('change', sourceChanged);
      server.watcher.on('unlink', sourceChanged);
      server.httpServer?.once('close', () => clearTimeout(reloadTimer));

      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD') return next();
        const name = resolveAssetName(req.url, viteBase, dir);
        if (name == null) return next();
        const ext = extname(name).slice(1);
        if (!MIME[ext]) return next();
        coordinator
          .ensure()
          .then(() => {
            const body = coordinator.get()?.get(name);
            if (body == null) return next();
            res.setHeader('Content-Type', MIME[ext]);
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Content-Length', String(Buffer.byteLength(body)));
            res.end(method === 'HEAD' ? undefined : body);
          })
          .catch(next);
      });
    },
    async generateBundle() {
      const isClient = typeof this.environment?.name === 'string' ? this.environment.name === 'client' : !ssrBuild;
      if (!isClient) return;
      await coordinator.ensure();
      const assets = coordinator.get();
      if (!assets) return;
      for (const [name, source] of assets) {
        this.emitFile({ type: 'asset', fileName: `${dir}/${name}`, source });
      }
    },
    transformIndexHtml: {
      order: 'post',
      handler: (html) => {
        const match = findViewport(html);
        // Fall back to Vite's default head injection if the marker is missing.
        if (!match) return links;
        const at = match.index! + match[0].length;
        const rendered = links.map((t) => `  ${renderTag(t)}`).join('\n');
        return html.slice(0, at) + '\n' + rendered + html.slice(at);
      },
    },
  };
}
