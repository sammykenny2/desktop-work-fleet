/** Read allowlisted public build settings. Does not initialize Google or handle credentials. */
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export const platforms = ['windows', 'macos', 'linux', 'ios', 'android'];
export async function readBuildConfig(root, environment = process.env) {
  let file = {};
  try { file = parseEnv(await readFile(new URL('.env', root), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const values = { ...file, ...environment };
  const value = name => (values[name] || '').trim();
  const config = { schemaVersion: 1, appId: value('WORK_FLEET_APP_ID'),
    appleTeamId: value('WORK_FLEET_APPLE_TEAM_ID'), google: { projectId: value('WORK_FLEET_GOOGLE_PROJECT_ID'), clients: {} },
    release: { privacyUrl: value('WORK_FLEET_PRIVACY_URL'), supportUrl: value('WORK_FLEET_SUPPORT_URL'), supportEmail: value('WORK_FLEET_SUPPORT_EMAIL') } };
  for (const platform of platforms) {
    const name = `WORK_FLEET_GOOGLE_${platform.toUpperCase()}_CLIENT_ID`;
    const client = value(name);
    if (client && !/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(client)) throw new Error(`${name} 格式無效。`);
    config.google.clients[platform] = client;
  }
  const webClient = value('WORK_FLEET_GOOGLE_WEB_CLIENT_ID');
  if (webClient && !/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(webClient)) throw new Error('WORK_FLEET_GOOGLE_WEB_CLIENT_ID 格式無效。');
  config.google.clients.web = webClient;
  if (config.appId && !/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(config.appId)) {
    throw new Error('WORK_FLEET_APP_ID 每段必須以字母開頭且只含英數，以符合 Apple／Android 的共同格式。');
  }
  if (config.appleTeamId && !/^[A-Z0-9]{10}$/.test(config.appleTeamId)) throw new Error('WORK_FLEET_APPLE_TEAM_ID 必須是 10 碼英數識別字。');
  for (const [name, url] of Object.entries({ WORK_FLEET_PRIVACY_URL: config.release.privacyUrl, WORK_FLEET_SUPPORT_URL: config.release.supportUrl })) {
    if (url) {
      let parsed;
      try { parsed = new URL(url); } catch { throw new Error(`${name} 必須是公開 HTTPS URL。`); }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error(`${name} 必須是沒有憑證或 fragment 的 HTTPS URL。`);
    }
  }
  if (config.release.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.release.supportEmail)) throw new Error('WORK_FLEET_SUPPORT_EMAIL 格式無效。');
  return config;
}

export function missingReleaseConfig(config, platform) {
  if (!platforms.includes(platform)) throw new Error(`未知平台：${platform}`);
  return [
    ...(!config.appId ? ['WORK_FLEET_APP_ID'] : []),
    ...(!config.google.projectId ? ['WORK_FLEET_GOOGLE_PROJECT_ID'] : []),
    ...(!config.google.clients[platform] ? [`WORK_FLEET_GOOGLE_${platform.toUpperCase()}_CLIENT_ID`] : []),
    ...(platform === 'android' && !config.google.clients.web ? ['WORK_FLEET_GOOGLE_WEB_CLIENT_ID'] : []),
    ...(['macos', 'ios'].includes(platform) && !config.appleTeamId ? ['WORK_FLEET_APPLE_TEAM_ID'] : []),
    ...(!config.release?.privacyUrl ? ['WORK_FLEET_PRIVACY_URL'] : []),
    ...(!config.release?.supportUrl ? ['WORK_FLEET_SUPPORT_URL'] : []),
    ...(!config.release?.supportEmail ? ['WORK_FLEET_SUPPORT_EMAIL'] : []),
  ];
}
