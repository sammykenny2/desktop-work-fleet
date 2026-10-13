/** Package Linux source/runtime assets. Usage: node scripts/generate-linux-package.mjs [--help] */
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readBuildConfig } from './config.mjs';
import { writePaperIcon } from './apple-icons.mjs';
import { readPlatformVersion } from './platform-version.mjs';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/generate-linux-package.mjs\nRun npm run build first. Writes build/linux/work-fleet-VERSION, using src/native/linux/VERSION.');
} else {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const version = await readPlatformVersion('linux');
  const destination = path.join(root, 'build', 'linux', `work-fleet-${version}`);
  const config = await readBuildConfig(new URL('../', import.meta.url), process.env, { platform: 'linux' });
  const appId = config.appId || 'app.workfleet.preview';
  // The bundle is a work directory; rebuild it so removed sources never reach the tar.gz or DEB.
  await rm(destination, { recursive: true, force: true });
  for (const name of ['Native', 'Config', 'Icons', 'Desktop', 'Licenses']) await mkdir(path.join(destination, name), { recursive: true });
  await cp(path.join(root, 'build', 'app'), path.join(destination, 'Assets'), { recursive: true });
  for (const file of await readdir(path.join(root, 'src', 'native', 'linux'))) {
    if (file.endsWith('.py') || file === 'README.md') await cp(path.join(root, 'src', 'native', 'linux', file), path.join(destination, 'Native', file));
  }
  await writeFile(path.join(destination, 'Config', 'public.json'), JSON.stringify(config, null, 2) + '\n');
  await cp(path.join(root, 'LICENSE'), path.join(destination, 'Licenses', 'LICENSE'));
  await cp(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(destination, 'Licenses', 'THIRD-PARTY-NOTICES.md'));
  await writePaperIcon(path.join(destination, 'Icons', `${appId}.png`));
  await writeFile(path.join(destination, 'run-work-fleet.sh'), `#!/bin/bash
# Launch the packaged native app using the distribution's Python/GI runtime.
# Uses /usr/bin/python3 when present; WORK_FLEET_PYTHON selects another interpreter with the same GI bindings.
# Usage: ./run-work-fleet.sh [--help] [--data PATH]
set -euo pipefail
usage() { echo 'Usage: ./run-work-fleet.sh [--help] [--data PATH]'; }
if [[ "\${1:-}" == '--help' ]]; then usage; exit 0; fi
APP_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
# A python3 found on PATH may be a pyenv or virtualenv interpreter without the distribution's GI bindings.
PYTHON="\${WORK_FLEET_PYTHON:-}"
if [[ -z "$PYTHON" ]]; then
  if [[ -x /usr/bin/python3 ]]; then PYTHON=/usr/bin/python3; else PYTHON=python3; fi
fi
export PYTHONNOUSERSITE=1
export PYTHONDONTWRITEBYTECODE=1
umask 077
exec "$PYTHON" "$APP_ROOT/Native/host.py" --assets "$APP_ROOT/Assets" --config "$APP_ROOT/Config/public.json" "$@"
`, { mode: 0o755 });
  await writeFile(path.join(destination, 'Desktop', `${appId}.desktop`), `[Desktop Entry]
Type=Application
Name=Work Fleet
Comment=Quick work notes with optional Google sync
Exec=work-fleet
Icon=${appId}
Terminal=false
Categories=Office;Utility;
StartupNotify=true
`);
  await writeFile(path.join(destination, 'package.json'), JSON.stringify({ appId, version, runtime: ['python3>=3.10', 'python3-gi', 'python3-gi-cairo', 'python3-cairo', 'python3-cryptography', 'gir1.2-gtk-3.0', 'gir1.2-webkit2-4.1', 'gir1.2-secret-1'], optionalRuntime: ['gir1.2-gtklayershell-0.1', 'gir1.2-keybinder-3.0', 'gir1.2-ayatanaappindicator3-0.1', 'xdg-desktop-portal'], binariesBuilt: false }, null, 2) + '\n');
  console.log(`Packaged build/linux/work-fleet-${version} (system GTK/WebKit/Secret Service required).`);
}
