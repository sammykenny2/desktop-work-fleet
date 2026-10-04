/** Generate public archive export options. Usage: node scripts/generate-apple-export-options.mjs --platform ios|macos --method METHOD --output PATH */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildConfig } from './config.mjs';
const args = process.argv.slice(2), methods = ['app-store-connect', 'developer-id', 'debugging', 'release-testing'];
if (args.length === 1 && args[0] === '--help') console.log('Usage: node scripts/generate-apple-export-options.mjs --platform ios|macos --method METHOD --output PATH');
else {
  if (args.length !== 6 || args[0] !== '--platform' || args[2] !== '--method' || args[4] !== '--output' || !['ios', 'macos'].includes(args[1]) || !methods.includes(args[3]) || args[1] === 'ios' && args[3] === 'developer-id') throw new Error('Invalid export options; use --help.');
  const root = fileURLToPath(new URL('../', import.meta.url)), output = path.resolve(args[5]), relative = path.relative(path.join(root, 'build', 'apple'), output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Export options must be under build/apple.');
  const config = await readBuildConfig(new URL('../', import.meta.url));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>method</key><string>${args[3]}</string><key>destination</key><string>export</string><key>signingStyle</key><string>automatic</string><key>manageAppVersionAndBuildNumber</key><false/>${config.appleTeamId ? `<key>teamID</key><string>${config.appleTeamId}</string>` : ''}</dict></plist>\n`);
  console.log('Generated public Apple export options.');
}
