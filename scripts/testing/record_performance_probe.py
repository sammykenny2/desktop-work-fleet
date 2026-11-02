"""Measure production Apple SQLite/AES-GCM storage using disposable synthetic data.

Usage: python3 scripts/testing/record_performance_probe.py [--output build/record-performance-apple.json]
The component timings include JSON encoding, staging, encryption and SQLite I/O;
they exclude JS, WebKit message dispatch, UI, Keychain and network.
"""
import argparse
import json
from pathlib import Path
import platform
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='build/record-performance-apple.json')
    args = parser.parse_args()
    if platform.system() != 'Darwin':
        parser.error('This probe needs macOS and the installed Swift SDK')
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='work-fleet-record-performance-') as temporary:
        folder = Path(temporary)
        executable = folder / 'RecordPerformanceProbe'
        subprocess.run(['swiftc', '-O', '-swift-version', '5', '-module-cache-path', str(folder / 'module-cache'),
                        str(root / 'src/native/apple/Shared/FleetProtocol.swift'),
                        str(root / 'src/native/apple/Shared/FleetDatabase.swift'),
                        str(root / 'tests/native/apple/RecordPerformanceProbe.swift'), '-o', str(executable)], check=True)
        result = subprocess.run([str(executable), str(folder / 'data')], text=True, capture_output=True, check=True)
        report = {'platform': platform.platform(), 'cpu': subprocess.check_output(['sysctl', '-n', 'machdep.cpu.brand_string'], text=True).strip(),
                  'swift': subprocess.check_output(['swiftc', '--version'], text=True).strip(),
                  'scope': 'Production Apple database component, optimized build, synthetic key, 128-character text per row. Includes JSON, staging, AES-GCM and SQLite. Excludes JS/WebKit dispatch/UI/network.',
                  'samples': 12, 'warmups': 2, 'results': json.loads(result.stdout)}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    print(f'PASS production Apple record component benchmark: {output}')


if __name__ == '__main__':
    main()
