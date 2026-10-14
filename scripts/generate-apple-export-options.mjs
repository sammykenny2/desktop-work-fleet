/** Generate public archive export options; manual Developer ID exports accept an identity and profile UUID. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readBuildConfig } from './config.mjs';
const methods = ['app-store-connect', 'developer-id', 'debugging', 'release-testing'];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function appleExportOptions({ platform, method, config, applicationIdentity = '', provisioningProfile = '' }) {
  if (!['ios', 'macos'].includes(platform) || !methods.includes(method) || platform === 'ios' && method === 'developer-id') throw new Error('Invalid export options; use --help.');
  const manual = Boolean(applicationIdentity || provisioningProfile);
  if (manual && (platform !== 'macos' || method !== 'developer-id' || !applicationIdentity || !provisioningProfile || !config.appId || !config.appleTeamId)) {
    throw new Error('Manual export requires macOS Developer ID, an application identity, profile, app ID and team ID.');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>method</key><string>${method}</string><key>destination</key><string>export</string><key>signingStyle</key><string>${manual ? 'manual' : 'automatic'}</string><key>manageAppVersionAndBuildNumber</key><false/>${config.appleTeamId ? `<key>teamID</key><string>${escape(config.appleTeamId)}</string>` : ''}${manual ? `<key>signingCertificate</key><string>${escape(applicationIdentity)}</string><key>provisioningProfiles</key><dict><key>${escape(config.appId)}</key><string>${escape(provisioningProfile)}</string></dict>` : ''}</dict></plist>\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { platform: { type: 'string' }, method: { type: 'string' }, output: { type: 'string' },
    'application-identity': { type: 'string' }, 'provisioning-profile': { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: node scripts/generate-apple-export-options.mjs --platform ios|macos --method METHOD --output PATH [--application-identity NAME --provisioning-profile UUID]');
  } else {
    if (!values.output) throw new Error('Specify --output under build/apple.');
    const root = fileURLToPath(new URL('../', import.meta.url)), output = path.resolve(values.output), relative = path.relative(path.join(root, 'build', 'apple'), output);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Export options must be under build/apple.');
    const config = await readBuildConfig(new URL('../', import.meta.url));
    const contents = appleExportOptions({ platform: values.platform, method: values.method, config,
      applicationIdentity: values['application-identity'], provisioningProfile: values['provisioning-profile'] });
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, contents);
    console.log('Generated public Apple export options.');
  }
}
