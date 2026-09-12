import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npmCli = process.env.npm_execpath;
const version = process.argv[2];

if (!npmCli) throw new Error('release must be run through npm.');
if (!version) throw new Error('Usage: npm run release <version>');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Version ${JSON.stringify(version)} is not a plain semver version.`);
}

const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const npm = (args) =>
  execFileSync(process.execPath, [npmCli, ...args], { cwd: root, stdio: 'inherit' });

const tag = `v${version}`;
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);

if (branch !== 'main') throw new Error(`Releases are cut from main, not ${branch}.`);
if (git(['status', '--porcelain'])) throw new Error('Working tree is not clean.');

git(['fetch', 'origin', 'main']);
if (git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main'])) {
  throw new Error('Local main and origin/main have diverged.');
}

const { version: current } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (current === version) throw new Error(`package.json is already at ${version}.`);
if (git(['tag', '--list', tag])) throw new Error(`Tag ${tag} already exists.`);
if (git(['ls-remote', '--tags', 'origin', tag])) throw new Error(`Tag ${tag} already exists on origin.`);

npm(['run', 'lint']);
npm(['run', 'typecheck']);
npm(['test']);
npm(['run', 'test:package']);

npm(['version', version, '--no-git-tag-version']);
git(['commit', '-am', `Release ${tag}`]);
git(['tag', '-a', tag, '-m', tag]);

console.log(`\nReleased ${tag} locally. To publish:\n\n  git push origin main ${tag}\n  gh release create ${tag} --title ${tag} --generate-notes\n`);
