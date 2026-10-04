/** Output only SDK path settings used by native build wrappers. Usage: node scripts/toolchain-env.mjs */
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
let file = {};
try { file = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const values = { ...file, ...process.env };
console.log(JSON.stringify(Object.fromEntries(['ANDROID_HOME', 'JAVA_HOME', 'DEVELOPER_DIR'].map(key => [key, values[key] || '']))));
