/**
 * Read allowlisted build settings. Does not initialize Google or handle user credentials.
 * Google's token endpoint requires the client secret of a Desktop-type client even with PKCE; Google treats an installed
 * app's secret as non-confidential, so it ships inside the Windows/Linux app. Only the platform passed in `options`
 * receives it, so Android/Apple/renderer bundles never do.
 */
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export const platforms = ['windows', 'macos', 'linux', 'ios', 'android'];
export const secretPlatforms = ['windows', 'linux'];

/**
 * ADR-043 startup timings, the one source every desktop host reads through Config/public.json. They live in
 * config/startup.json rather than .env: they are product behaviour, the same for every build, not a builder's setting.
 */
export function parseStartupConfig(text) {
  const value = JSON.parse(text);
  const seconds = value?.trayWaitSeconds;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 300) throw new Error('trayWaitSeconds in config/startup.json must be a whole number of seconds from 0 to 300.');
  return { trayWaitSeconds: seconds };
}

export async function readBuildConfig(root, environment = process.env, { platform } = {}) {
  let file = {};
  try { file = parseEnv(await readFile(new URL('.env', root), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const values = { ...file, ...environment };
  const value = name => (values[name] || '').trim();
  const config = { schemaVersion: 1, appId: value('PIN_IT_ANYWHERE_APP_ID'),
    appleTeamId: value('PIN_IT_ANYWHERE_APPLE_TEAM_ID'), google: { projectId: value('PIN_IT_ANYWHERE_GOOGLE_PROJECT_ID'), clients: {} },
    release: { privacyUrl: value('PIN_IT_ANYWHERE_PRIVACY_URL'), supportUrl: value('PIN_IT_ANYWHERE_SUPPORT_URL'), supportEmail: value('PIN_IT_ANYWHERE_SUPPORT_EMAIL') } };
  for (const platform of platforms) {
    const name = `PIN_IT_ANYWHERE_GOOGLE_${platform.toUpperCase()}_CLIENT_ID`;
    const client = value(name);
    if (client && !/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(client)) throw new Error(`${name} has an invalid format.`);
    config.google.clients[platform] = client;
  }
  const webClient = value('PIN_IT_ANYWHERE_GOOGLE_WEB_CLIENT_ID');
  if (webClient && !/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(webClient)) throw new Error('PIN_IT_ANYWHERE_GOOGLE_WEB_CLIENT_ID has an invalid format.');
  config.google.clients.web = webClient;
  for (const name of secretPlatforms) {
    const secret = value(`PIN_IT_ANYWHERE_GOOGLE_${name.toUpperCase()}_CLIENT_SECRET`);
    if (secret && !/^[!-~]{1,256}$/.test(secret)) throw new Error(`PIN_IT_ANYWHERE_GOOGLE_${name.toUpperCase()}_CLIENT_SECRET has an invalid format.`);
    if (secret && name === platform) config.google.secrets = { [name]: secret };
  }
  if (config.appId && !/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(config.appId)) {
    throw new Error('Each part of PIN_IT_ANYWHERE_APP_ID must start with a letter and contain only letters and digits, the format Apple and Android share.');
  }
  if (config.appleTeamId && !/^[A-Z0-9]{10}$/.test(config.appleTeamId)) throw new Error('PIN_IT_ANYWHERE_APPLE_TEAM_ID must be a 10-character alphanumeric identifier.');
  config.appleAppGroupId = value('PIN_IT_ANYWHERE_APP_GROUP_ID') || `group.${config.appId || 'dev.sammykenny2.pinitanywhere'}`;
  if (!/^group\.[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(config.appleAppGroupId)) throw new Error('PIN_IT_ANYWHERE_APP_GROUP_ID must be a valid App Group ID that starts with group.');
  config.windows = { packageId: value('PIN_IT_ANYWHERE_WINDOWS_PACKAGE_ID'), publisher: value('PIN_IT_ANYWHERE_WINDOWS_PUBLISHER'), publisherDisplayName: value('PIN_IT_ANYWHERE_WINDOWS_PUBLISHER_DISPLAY_NAME') };
  if (config.windows.packageId && !/^[a-zA-Z0-9.-]{3,50}$/.test(config.windows.packageId)) throw new Error('PIN_IT_ANYWHERE_WINDOWS_PACKAGE_ID must be 3–50 letters, digits, dots or hyphens.');
  for (const [key, field] of Object.entries(config.windows)) if (field.length > 256 || /[\u0000-\u001f]/.test(field)) throw new Error(`Windows ${key} has an invalid format or length.`);
  for (const [name, url] of Object.entries({ PIN_IT_ANYWHERE_PRIVACY_URL: config.release.privacyUrl, PIN_IT_ANYWHERE_SUPPORT_URL: config.release.supportUrl })) {
    if (url) {
      let parsed;
      try { parsed = new URL(url); } catch { throw new Error(`${name} must be a public HTTPS URL.`); }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error(`${name} must be an HTTPS URL without credentials or a fragment.`);
    }
  }
  if (config.release.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.release.supportEmail)) throw new Error('PIN_IT_ANYWHERE_SUPPORT_EMAIL has an invalid format.');
  // ADR-044: in-app updates read this public repository's GitHub Releases; only the preview channel exists so far.
  config.update = { repository: value('PIN_IT_ANYWHERE_UPDATE_REPOSITORY') || 'sammykenny2/pin-it-anywhere', channel: value('PIN_IT_ANYWHERE_UPDATE_CHANNEL') || 'preview' };
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/.test(config.update.repository)) throw new Error('PIN_IT_ANYWHERE_UPDATE_REPOSITORY must be owner/repo.');
  if (config.update.channel !== 'preview') throw new Error('PIN_IT_ANYWHERE_UPDATE_CHANNEL supports only preview for now.');
  // The Sparkle EdDSA public key the macOS app checks updates against; the private key never leaves the maintainer's Mac or CI secret.
  config.update.macosPublicKey = value('PIN_IT_ANYWHERE_SPARKLE_PUBLIC_KEY');
  if (config.update.macosPublicKey && !/^[A-Za-z0-9+/]{43}=$/.test(config.update.macosPublicKey)) throw new Error('PIN_IT_ANYWHERE_SPARKLE_PUBLIC_KEY must be the base64 public key that generate_keys prints.');
  config.startup = parseStartupConfig(await readFile(new URL('../config/startup.json', import.meta.url), 'utf8'));
  return config;
}

export function missingGoogleConfig(config, platform) {
  if (!platforms.includes(platform)) throw new Error(`Unknown platform: ${platform}`);
  return [
    ...(!config.google.projectId ? ['PIN_IT_ANYWHERE_GOOGLE_PROJECT_ID'] : []),
    ...(!config.google.clients[platform] ? [`PIN_IT_ANYWHERE_GOOGLE_${platform.toUpperCase()}_CLIENT_ID`] : []),
    ...(platform === 'android' && !config.google.clients.web ? ['PIN_IT_ANYWHERE_GOOGLE_WEB_CLIENT_ID'] : []),
  ];
}

export function missingReleaseConfig(config, platform) {
  return [
    ...missingGoogleConfig(config, platform),
    ...(!config.appId ? ['PIN_IT_ANYWHERE_APP_ID'] : []),
    ...(['macos', 'ios'].includes(platform) && !config.appleTeamId ? ['PIN_IT_ANYWHERE_APPLE_TEAM_ID'] : []),
    ...(platform === 'windows' && !config.windows?.packageId ? ['PIN_IT_ANYWHERE_WINDOWS_PACKAGE_ID'] : []),
    ...(platform === 'windows' && !config.windows?.publisher ? ['PIN_IT_ANYWHERE_WINDOWS_PUBLISHER'] : []),
    ...(!config.release?.privacyUrl ? ['PIN_IT_ANYWHERE_PRIVACY_URL'] : []),
    ...(!config.release?.supportUrl ? ['PIN_IT_ANYWHERE_SUPPORT_URL'] : []),
    ...(!config.release?.supportEmail ? ['PIN_IT_ANYWHERE_SUPPORT_EMAIL'] : []),
  ];
}
