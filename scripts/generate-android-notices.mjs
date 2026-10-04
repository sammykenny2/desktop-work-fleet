/** Bundle resolved Android runtime metadata/notices. Usage: node scripts/generate-android-notices.mjs --input PATH --output PATH */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') console.log('Usage: node scripts/generate-android-notices.mjs --input PATH --output PATH');
else {
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output') throw new Error('Use --help.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = path.resolve(args[3]), base = path.join(root, 'src/native/android/app/build/generated/native-notices');
  const relative = path.relative(base, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output must be in the generated native-notices directory.');
  const input = JSON.parse(await readFile(args[1], 'utf8'));
  if (!['debug', 'release'].includes(input.variant) || !Array.isArray(input.artifacts)) throw new Error('Invalid runtime inventory.');
  const destination = path.join(output, 'licenses', 'native');
  await mkdir(destination, { recursive: true });
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const decode = text => text.replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]).trim();
  const textField = (text, name) => decode(text.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '');
  const isNotice = name => /^(?:license|licence|notice|copying)(?:[. _-]|$)/i.test(path.posix.basename(name)) && !/\.(?:class|jar|png|jpg)$/i.test(name);
  const libraries = [];
  for (const artifact of input.artifacts) {
    for (const field of ['group', 'name', 'version', 'file']) if (typeof artifact[field] !== 'string' || !artifact[field]) throw new Error('Invalid artifact metadata.');
    const bytes = await readFile(artifact.file);
    if (bytes.length > 128 * 1024 * 1024) throw new Error('Runtime artifact is too large for notice extraction.');
    const sha256 = hash(bytes), coordinate = `${artifact.group}:${artifact.name}:${artifact.version}`;
    const folder = `artifact-${hash(Buffer.from(coordinate)).slice(0, 16)}-${sha256.slice(0, 12)}`;
    await mkdir(path.join(destination, folder), { recursive: true });
    const notices = [];
    const saveNotices = async (archive, prefix) => {
      for (const [name, content] of Object.entries(archive)) if (isNotice(name)) {
        const origin = prefix + name;
        const file = `${folder}/notice-${hash(Buffer.from(origin)).slice(0, 16)}-${path.posix.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}`;
        await writeFile(path.join(destination, file), content);
        notices.push({ origin, file, sha256: hash(content) });
      }
    };
    const archive = unzipSync(bytes, { filter: entry => {
      const wanted = isNotice(entry.name) || entry.name === 'classes.jar' || /^libs\/[^/]+\.jar$/i.test(entry.name);
      if (wanted && entry.originalSize > 128 * 1024 * 1024) throw new Error('Embedded SDK file is too large.');
      return wanted;
    } });
    await saveNotices(archive, '');
    for (const [name, content] of Object.entries(archive)) if (/\.jar$/i.test(name)) {
      const nested = unzipSync(content, { filter: entry => {
        if (isNotice(entry.name) && entry.originalSize > 16 * 1024 * 1024) throw new Error('SDK notice is too large.');
        return isNotice(entry.name);
      } });
      await saveNotices(nested, `${name}!`);
    }
    let pom = '', pomFile = null;
    if (artifact.pom) {
      pom = await readFile(artifact.pom, 'utf8'); pomFile = `${folder}/pom.xml`;
      await copyFile(artifact.pom, path.join(destination, pomFile));
    }
    const section = pom.match(/<licenses\b[^>]*>([\s\S]*?)<\/licenses>/i)?.[1] || '';
    const declaredLicenses = [...section.matchAll(/<license\b[^>]*>([\s\S]*?)<\/license>/gi)].map(match => ({ name: textField(match[1], 'name'), url: textField(match[1], 'url') }));
    libraries.push({ coordinate, fileName: path.basename(artifact.file), sha256, pomFile, declaredLicenses, notices,
      metadataStatus: !pom ? 'pom-unavailable' : declaredLicenses.length ? 'declared-in-pom' : 'no-license-declaration-in-pom' });
  }
  await copyFile(path.join(root, 'src/native/licenses/apache-2.0-LICENSE.txt'), path.join(destination, 'APACHE-2.0.txt'));
  await writeFile(path.join(destination, 'inventory.json'), JSON.stringify({ schemaVersion: 1, platform: 'android', variant: input.variant, libraries }, null, 2) + '\n');
  await writeFile(path.join(destination, 'README.txt'), 'Resolved runtime artifacts and upstream POM/license/notice files. MetadataStatus records missing declarations without assuming a license. Apache-2.0 text accompanies the AndroidX declarations. Google SDK terms and final release obligations still require the shipped package inventory. No credentials or local artifact paths are included.\n');
  console.log(`Bundled Android ${input.variant} runtime inventory (${libraries.length} artifacts).`);
}
