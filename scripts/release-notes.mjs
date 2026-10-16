/** Read one version's entry from docs/release-notes.md. Usage: node scripts/release-notes.mjs --version X.Y.Z [--summary] [--file PATH] [--help] */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const releaseNotesFile = 'docs/release-notes.md';
const SUMMARY_LIMIT = 500;

/**
 * An entry is a "## <version>" section with a "Platforms:" line, a one-line "Summary:" for the in-app updaters and the
 * change bullets. The version-bump commit writes it; release workflows only read it.
 */
export function releaseEntry(text, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('The version must be numeric x.y.z.');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => line === `## ${version}`);
  if (start < 0) throw new Error(`${releaseNotesFile} has no "## ${version}" entry. The version-bump commit adds it.`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const body = lines.slice(start + 1, end < 0 ? undefined : end);
  const field = name => {
    const matches = body.filter(line => line.startsWith(`${name}: `));
    if (matches.length !== 1) throw new Error(`The ${version} entry needs exactly one "${name}:" line.`);
    return matches[0].slice(name.length + 2).trim();
  };
  const platforms = field('Platforms').replace(/\.$/, '').split(',').map(item => item.trim()).filter(Boolean);
  const summary = field('Summary');
  if (!platforms.length) throw new Error(`The ${version} entry lists no platforms.`);
  if (!summary || summary.length > SUMMARY_LIMIT) throw new Error(`The ${version} summary must be 1-${SUMMARY_LIMIT} characters.`);
  const changes = body.filter(line => !/^(Platforms|Summary): /.test(line)).join('\n').trim();
  if (!changes) throw new Error(`The ${version} entry has no changes.`);
  return { version, platforms, summary, changes };
}

export async function readReleaseEntry(version, file = path.join(repositoryRoot, releaseNotesFile)) {
  return releaseEntry(await readFile(file, 'utf8'), version);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { help: { type: 'boolean' }, version: { type: 'string' }, summary: { type: 'boolean' }, file: { type: 'string' } } });
  if (values.help) {
    console.log(`Usage: node scripts/release-notes.mjs --version X.Y.Z [--summary] [--file PATH]
Prints the change bullets of that version's entry in ${releaseNotesFile}, or with --summary its one-line summary.
Fails when the entry is missing or malformed, so a release cannot start without notes.`);
  } else {
    const entry = await readReleaseEntry(values.version, values.file ? path.resolve(values.file) : undefined);
    console.log(values.summary ? entry.summary : entry.changes);
  }
}
