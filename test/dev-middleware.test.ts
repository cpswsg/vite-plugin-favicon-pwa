import { afterAll, describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import faviconPwa from '../src/index';

// A red square on a 10x10 viewBox, with the fill on the root so the generated
// favicon.svg visibly reflects the source (used to prove regeneration).
const logo = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" fill="${fill}"><rect width="10" height="10"/></svg>`;

const projects: string[] = [];
const waitForReload = () => new Promise((resolve) => setTimeout(resolve, 40));
afterAll(() => {
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

// Minimal stand-in for the bits of ViteDevServer the plugin touches, so the real
// configureServer wiring runs without a live server or file watcher.
function createMockServer() {
  const handlers = new Map<string, Array<(file: string) => void>>();
  const server = {
    middleware: null as ((req: unknown, res: unknown, next: unknown) => void) | null,
    added: [] as string[],
    wsMessages: [] as unknown[],
    middlewares: {
      use: (fn: (req: unknown, res: unknown, next: unknown) => void) => {
        server.middleware = fn;
      },
    },
    watcher: {
      add: (p: string) => server.added.push(p),
      on: (event: string, fn: (file: string) => void) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(fn);
        handlers.set(event, eventHandlers);
      },
    },
    ws: { send: (msg: unknown) => server.wsMessages.push(msg) },
    fire: (event: string, file: string) => handlers.get(event)?.forEach((fn) => fn(file)),
  };
  return server;
}

// Drive the captured middleware with a fake req/res/next and resolve with the
// outcome: a served response (body + headers) or a next() call (with an error
// for the .catch(next) path).
function request(middleware: (req: unknown, res: unknown, next: unknown) => void, url: string, method = 'GET') {
  return new Promise<{ served: boolean; body?: unknown; headers: Record<string, string>; error?: unknown }>((resolve) => {
    const headers: Record<string, string> = {};
    const req = { url, method };
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      end: (body: unknown) => resolve({ served: true, body, headers }),
    };
    const next = (error?: unknown) => resolve({ served: false, headers, error });
    middleware(req, res, next);
  });
}

function setup(svg: string, { base = '/', outDir }: { base?: string; outDir?: string } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'vfp-mw-')));
  projects.push(root);
  writeFileSync(join(root, 'logo.svg'), svg);
  const plugin = faviconPwa({ name: 'Fixture App', source: 'logo.svg', outDir });
  (plugin.configResolved as (c: { root: string; base: string; build: { ssr?: boolean } }) => void)({
    root,
    base,
    build: {},
  });
  const server = createMockServer();
  (plugin.configureServer as (s: unknown) => void)(server);
  return { root, server, middleware: server.middleware! };
}

describe('dev middleware', () => {
  it('serves each asset with the correct content type and body', async () => {
    const { middleware } = setup(logo('#123456'));

    const ico = await request(middleware, '/assets/favicons/favicon.ico');
    expect(ico.served).toBe(true);
    expect(ico.headers['Content-Type']).toBe('image/x-icon');
    expect(ico.headers['Cache-Control']).toBe('no-store');
    const icoBody = ico.body as Buffer;
    expect(Buffer.isBuffer(icoBody) && icoBody[0] === 0x00 && icoBody[1] === 0x00 && icoBody[2] === 0x01).toBe(true);

    const png = await request(middleware, '/assets/favicons/pwa-512x512.png');
    expect(png.headers['Content-Type']).toBe('image/png');
    const pngBody = png.body as Buffer;
    expect(Buffer.isBuffer(pngBody) && pngBody[0] === 0x89 && pngBody[1] === 0x50).toBe(true);

    const manifest = await request(middleware, '/assets/favicons/manifest.webmanifest');
    expect(manifest.headers['Content-Type']).toBe('application/manifest+json');
    expect(JSON.parse(String(manifest.body)).icons).toHaveLength(3);

    const svg = await request(middleware, '/assets/favicons/favicon.svg');
    expect(svg.headers['Content-Type']).toBe('image/svg+xml');
  }, 30000);

  it('serves root-level assets when the output directory is the site root', async () => {
    const { middleware } = setup(logo('#123456'), { outDir: '' });

    const ico = await request(middleware, '/favicon.ico');
    expect(ico.served).toBe(true);
    expect(ico.headers['Content-Type']).toBe('image/x-icon');

    const manifest = await request(middleware, '/manifest.webmanifest');
    expect(manifest.served).toBe(true);
    expect(manifest.headers['Content-Type']).toBe('application/manifest+json');
    expect(JSON.parse(String(manifest.body)).start_url).toBe('/');

    const svg = await request(middleware, '/favicon.svg');
    expect(svg.headers['Content-Type']).toBe('image/svg+xml');
    expect(String(svg.body)).toContain('fill="#123456"');
  }, 30000);

  it('serves root-level assets under a subpath base', async () => {
    const { middleware } = setup(logo('#123456'), { base: '/subpath/', outDir: '/' });

    const ico = await request(middleware, '/subpath/favicon.ico');
    expect(ico.served).toBe(true);
    expect(ico.headers['Content-Type']).toBe('image/x-icon');

    const unprefixed = await request(middleware, '/favicon.ico');
    expect(unprefixed.served).toBe(true);

    const elsewhere = await request(middleware, '/other/favicon.ico');
    expect(elsewhere.served).toBe(false);
  }, 30000);

  it('does not generate assets for an unrelated root-level path', async () => {
    const { middleware } = setup('<svg></svg>', { outDir: '' });

    const bundled = await request(middleware, '/assets/index-abc123.png');
    expect(bundled.served).toBe(false);
    expect(bundled.error).toBeUndefined();

    const ours = await request(middleware, '/favicon.ico');
    expect(ours.error).toBeInstanceOf(Error);
  }, 30000);

  it('falls through for a public file that is not part of the generated set', async () => {
    const { middleware } = setup('<svg></svg>', { outDir: '' });

    for (const url of ['/vite.svg', '/logo.png', '/og-image.png', '/site.webmanifest']) {
      const res = await request(middleware, url);
      expect(res.served, url).toBe(false);
      expect(res.error, url).toBeUndefined();
    }
  }, 30000);

  it('does not let an unrelated root request surface a generation failure', async () => {
    const { middleware } = setup('<svg></svg>', { outDir: '' });

    const unrelated = await request(middleware, '/vite.svg');
    expect(unrelated.error).toBeUndefined();

    const ours = await request(middleware, '/favicon.svg');
    expect(ours.error).toBeInstanceOf(Error);
  }, 30000);

  it('serves HEAD without a body and ignores unsupported methods', async () => {
    const { middleware } = setup(logo('#123456'));

    const head = await request(middleware, '/assets/favicons/favicon.svg', 'HEAD');
    expect(head.served).toBe(true);
    expect(head.body).toBeUndefined();
    expect(Number(head.headers['Content-Length'])).toBeGreaterThan(0);
    expect(head.headers['Cache-Control']).toBe('no-store');

    const post = await request(middleware, '/assets/favicons/favicon.svg', 'POST');
    expect(post.served).toBe(false);
  }, 30000);

  it('falls through for non-asset paths and unsupported extensions', async () => {
    const { middleware } = setup(logo('#123456'));

    const html = await request(middleware, '/index.html');
    expect(html.served).toBe(false);
    expect(html.error).toBeUndefined();

    const txt = await request(middleware, '/assets/favicons/nope.txt');
    expect(txt.served).toBe(false);
    expect(txt.error).toBeUndefined();
  }, 30000);

  it('regenerates and reloads on a source change, but ignores unrelated changes', async () => {
    const { root, server, middleware } = setup(logo('#111111'));
    expect(server.added).toEqual([join(root, 'logo.svg')]);

    const first = await request(middleware, '/assets/favicons/favicon.svg');
    expect(String(first.body)).toContain('fill="#111111"');

    // Source change: invalidate + exactly one full reload; the next serve reflects
    // the rewritten source.
    writeFileSync(join(root, 'logo.svg'), logo('#222222'));
    server.fire('change', join(root, 'logo.svg'));
    await waitForReload();
    expect(server.wsMessages).toEqual([{ type: 'full-reload' }]);
    const second = await request(middleware, '/assets/favicons/favicon.svg');
    expect(String(second.body)).toContain('fill="#222222"');
    expect(String(second.body)).not.toContain('#111111');

    // Unrelated change: no reload and no invalidation (the cached asset stands).
    writeFileSync(join(root, 'logo.svg'), logo('#333333'));
    server.fire('change', join(root, 'other.svg'));
    await waitForReload();
    expect(server.wsMessages).toEqual([{ type: 'full-reload' }]);
    const third = await request(middleware, '/assets/favicons/favicon.svg');
    expect(String(third.body)).toContain('fill="#222222"');
  }, 30000);

  it('forwards a generation failure to next(error)', async () => {
    const { middleware } = setup('<svg></svg>'); // no viewBox -> generate throws

    const res = await request(middleware, '/assets/favicons/favicon.ico');
    expect(res.served).toBe(false);
    expect(res.error).toBeInstanceOf(Error);
    expect(String(res.error)).toMatch(/no viewBox/);
  }, 30000);
  it('invalidates for atomic-save add and unlink events', async () => {
    const { root, server, middleware } = setup(logo('#111111'));
    await request(middleware, '/assets/favicons/favicon.svg');

    writeFileSync(join(root, 'logo.svg'), logo('#222222'));
    server.fire('unlink', join(root, 'logo.svg'));
    server.fire('add', join(root, 'logo.svg'));
    await waitForReload();

    expect(server.wsMessages).toEqual([{ type: 'full-reload' }]);
    const regenerated = await request(middleware, '/assets/favicons/favicon.svg');
    expect(String(regenerated.body)).toContain('fill="#222222"');
  }, 30000);
});
