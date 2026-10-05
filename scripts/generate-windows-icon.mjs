/** Write the repository-owned paper icon used by the Windows executable, windows and tray. Usage: node scripts/generate-windows-icon.mjs */
import { writeFile } from 'node:fs/promises';
import { paperIco } from './apple-icons.mjs';

if (process.argv.slice(2).includes('--help')) {
  console.log('Usage: node scripts/generate-windows-icon.mjs\nRewrites src/native/windows/app/WorkFleet.ico (16-256 px). Commit the result; the project embeds it.');
} else {
  await writeFile(new URL('../src/native/windows/app/WorkFleet.ico', import.meta.url), paperIco());
  console.log('Generated WorkFleet.ico.');
}
