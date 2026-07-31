import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expected = `v${version}`;
const actual = process.env.GITHUB_REF_NAME;

if (actual !== expected) {
  console.error(`Release tag ${JSON.stringify(actual)} does not match package version ${JSON.stringify(expected)}.`);
  process.exitCode = 1;
}
