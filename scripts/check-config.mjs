/** Check public build settings. Usage: node scripts/check-config.mjs [--platform PLATFORM] [--help] */
import { readBuildConfig, missingReleaseConfig, platforms } from './config.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log(`Usage: node scripts/check-config.mjs [--platform ${platforms.join('|')}]\nWithout --platform, lists readiness without requiring Google configuration.`);
} else {
  try {
    if (args.length && !(args.length === 2 && args[0] === '--platform' && platforms.includes(args[1]))) {
      throw new Error('參數無效，請使用 --help。');
    }
    const config = await readBuildConfig(new URL('../', import.meta.url));
    for (const platform of args.length ? [args[1]] : platforms) {
      const missing = missingReleaseConfig(config, platform);
      console.log(`${platform}: ${missing.length ? `尚缺 ${missing.join(', ')}` : '公開設定完整；仍需真實登入、簽章及平台驗收'}`);
      if (args.length && missing.length) process.exitCode = 1;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
