import { readdirSync, type Dirent } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { oklchToRgb } from './color.js';
import { generate, GENERATED_ASSET_NAMES } from './generate.js';
import { createAssetCoordinator } from './coordinator.js';
import { assetBaseForHtml, normalizeOutDir, resolveAssetName } from './paths.js';
import { DEFAULTS, type FaviconsOptions } from './options.js';

export type { FaviconsOptions } from './options.js';

const MIME: Record<string, string> = {
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  png: 'image/png',
  webmanifest: 'application/manifest+json',
};

const GENERATED = new Set<string>(GENERATED_ASSET_NAMES);

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

  const provided = Object.fromEntries(
    Object.entries(userOptions).filter(([, value]) => value != null),
  ) as Partial<FaviconsOptions>;
  const options = { ...DEFAULTS, ...provided, name: userOptions.name };

  const validateFraction = (key: 'padding' | 'maskablePadding' | 'radius', upperInclusive: boolean) => {
    const value = options[key];
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
    options.manifestCrossOrigin !== undefined &&
    options.manifestCrossOrigin !== 'anonymous' &&
    options.manifestCrossOrigin !== 'use-credentials'
  ) {
    throw new TypeError('vite-plugin-favicon-pwa: "manifestCrossOrigin" must be "anonymous" or "use-credentials".');
  }

  // Normalise colour inputs so oklch() works everywhere sharp/the manifest read
  // them (resize background, SVG fills, theme colour). Hex/rgb/named pass through.
  options.background = oklchToRgb(options.background);
  options.themeColor = oklchToRgb(options.themeColor);
  if (options.foreground) options.foreground = oklchToRgb(options.foreground);

  const dir = normalizeOutDir(options.outDir);

  let root = process.cwd();
  // Vite's public base path (e.g. "/", "/subpath/", or "./" / "" for a relative
  // build), resolved in configResolved.
  let viteBase = '/';
  let ssrBuild = false;

  // Regenerate the asset set on demand; the coordinator commits only the newest
  // run, so a dev source-change can't be clobbered by a slower in-flight run.
  const coordinator = createAssetCoordinator(() => generate(root, options, viteBase, dir));

  // Public URL prefix for the asset <link> hrefs, incl. Vite's base so subpath
  // deploys resolve, e.g. "/subpath/assets/favicons/".
  const createHtmlTags = (base: string): Tag[] => [
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

  // Root outDir and publicDir target the same path and the loser is silent. At
  // build, Vite copies publicDir in prepareOutDir and Rollup writes over it; in
  // dev, this middleware is registered ahead of servePublicMiddleware. The
  // generated asset wins both ways, which is why serve still warns when
  // copyPublicDir is off: the shadowing is the middleware's, not the copy's.
  const warnPublicDirCollisions = (config: ResolvedConfig) => {
    const building = config.command === 'build';
    if (dir || !config.publicDir || config.build.ssr) return;
    if (building && !config.build.copyPublicDir) return;
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(config.publicDir, { withFileTypes: true });
    } catch {
      return;
    }
    const generated = new Set<string>(GENERATED_ASSET_NAMES.map((name) => name.toLowerCase()));
    const collisions = entries.filter((entry) => generated.has(entry.name.toLowerCase()));
    if (!collisions.length) return;
    const outDirPath = resolve(config.root, config.build.outDir);
    const warn = (group: Dirent[], outcome: string) => {
      if (!group.length) return;
      const paths = group.map((entry) => join(config.publicDir, entry.name)).join(', ');
      const inexact = group.some((entry) => !generated.has(entry.name));
      config.logger.warn(
        `vite-plugin-favicon-pwa: "outDir" is the site root, so ${outcome}: ${paths}. ` +
          'Rename those entries or move them out of the public directory.' +
          (inexact ? ' Names differing only in case collide on macOS and Windows.' : ''),
      );
    };
    // A directory cannot be overwritten by an emitted file, so at build the copy
    // leaves it in place and the bundle write fails outright.
    const blocking = building ? collisions.filter((entry) => entry.isDirectory()) : [];
    warn(blocking, `writing the generated favicon set over them in ${outDirPath} fails the build`);
    warn(
      collisions.filter((entry) => !blocking.includes(entry)),
      building
        ? `the generated favicon set overwrites them in ${outDirPath}`
        : 'the dev server serves the generated favicon set in their place',
    );
  };

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
      warnPublicDirCollisions(config);
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
        if (name == null || !GENERATED.has(name)) return next();
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
        this.emitFile({ type: 'asset', fileName: dir ? `${dir}/${name}` : name, source });
      }
    },
    transformIndexHtml: {
      order: 'post',
      handler: (html, ctx) => {
        const tags = createHtmlTags(assetBaseForHtml(viteBase, dir, ctx.path));
        const match = findViewport(html);
        // Fall back to Vite's default head injection if the marker is missing.
        if (!match) return tags;
        const at = match.index! + match[0].length;
        const rendered = tags.map((t) => `  ${renderTag(t)}`).join('\n');
        return html.slice(0, at) + '\n' + rendered + html.slice(at);
      },
    },
  };
}
