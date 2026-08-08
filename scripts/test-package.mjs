import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const temp = mkdtempSync(join(tmpdir(), 'vite-plugin-favicon-pwa-package-'));
const npmCli = process.env.npm_execpath;
const viteRanges = process.env.VITE_RANGES?.split(',') ?? ['^6.0.0', '^7.0.0', '^8.0.0'];

if (!npmCli) throw new Error('test:package must be run through npm.');

const npm = (args, cwd) =>
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    env: { ...process.env, npm_config_cache: join(temp, 'npm-cache') },
    stdio: 'inherit',
  });

try {
  npm(['pack', '--pack-destination', temp], root);
  const tarball = join(temp, `${manifest.name}-${manifest.version}.tgz`);

  for (const viteRange of viteRanges) {
    const consumer = join(temp, `vite-${viteRange.match(/\d+/)?.[0]}`);
    mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    npm(['install', '--ignore-scripts', tarball, `vite@${viteRange}`], consumer);

    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: false,
        },
        include: ['consumer.ts'],
      }),
    );
    writeFileSync(
      join(consumer, 'consumer.ts'),
      "import faviconPwa, { type FaviconsOptions } from 'vite-plugin-favicon-pwa';\nconst options: FaviconsOptions = { name: 'Consumer' };\nfaviconPwa(options);\n",
    );
    writeFileSync(
      join(consumer, 'vite.config.mjs'),
      "import faviconPwa from 'vite-plugin-favicon-pwa';\nexport default { logLevel: 'silent', plugins: [faviconPwa({ name: 'Consumer', source: 'logo.svg' })] };\n",
    );
    writeFileSync(join(consumer, 'index.html'), '<!doctype html><meta name="viewport" content="width=device-width">');
    writeFileSync(join(consumer, 'logo.svg'), '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>');

    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')], {
      cwd: consumer,
      stdio: 'inherit',
    });
    execFileSync(process.execPath, [join(consumer, 'node_modules/vite/bin/vite.js'), 'build'], {
      cwd: consumer,
      stdio: 'inherit',
    });
    if (!existsSync(join(consumer, 'dist/assets/favicons/manifest.webmanifest'))) {
      throw new Error(`Vite ${viteRange} consumer did not emit the manifest.`);
    }
    const shipped = readFileSync(
      join(consumer, 'node_modules', manifest.name, 'dist/generate.js'),
      'utf8',
    );
    const staticImports = shipped.match(/^\s*import\s[^\n]*from\s*['"](sharp|png-to-ico)['"]/gm);
    if (staticImports) {
      throw new Error(`Image dependencies must be imported lazily, found: ${staticImports.join(', ')}`);
    }

    writeFileSync(
      join(consumer, 'lazy-sharp.mjs'),
      [
        "const loaded = () => process.report.getReport().sharedObjects.filter((s) => /vips|sharp/i.test(s)).length;",
        "await import('vite-plugin-favicon-pwa');",
        'const afterPlugin = loaded();',
        "await import('sharp');",
        'const afterSharp = loaded();',
        "if (afterPlugin > 0) throw new Error('sharp was loaded eagerly by importing the plugin');",
        "if (afterSharp === 0) throw new Error('probe cannot detect sharp on this platform; the check would pass vacuously');",
      ].join('\n'),
    );
    execFileSync(process.execPath, [join(consumer, 'lazy-sharp.mjs')], { cwd: consumer, stdio: 'inherit' });

    const viteVersion = JSON.parse(readFileSync(join(consumer, 'node_modules/vite/package.json'), 'utf8')).version;
    console.log(`Verified ${basename(tarball)} with Vite ${viteVersion}`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
