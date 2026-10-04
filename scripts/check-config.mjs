/** Check public build settings. Usage: node scripts/check-config.mjs [--google] [--platform PLATFORM] [--help] */
import { readBuildConfig, missingGoogleConfig, missingReleaseConfig, platforms } from './config.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log(`Usage: node scripts/check-config.mjs [--google] [--platform ${platforms.join('|')}]\n--google checks only Google configuration. Without --platform, lists readiness without requiring configuration.`);
} else {
  try {
    let googleOnly = false, selected;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--google' && !googleOnly) googleOnly = true;
      else if (args[i] === '--platform' && !selected && platforms.includes(args[i + 1])) selected = args[++i];
      else throw new Error('參數無效，請使用 --help。');
    }
    const config = await readBuildConfig(new URL('../', import.meta.url));
    for (const platform of selected ? [selected] : platforms) {
      const missing = (googleOnly ? missingGoogleConfig : missingReleaseConfig)(config, platform);
      console.log(`${platform}: ${missing.length ? `尚缺 ${missing.join(', ')}` : googleOnly ? 'Google 公開設定完整；仍需 Cloud 設定與真實登入' : '公開設定完整；仍需真實登入、簽章及平台驗收'}`);
      if (selected && missing.length) process.exitCode = 1;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
