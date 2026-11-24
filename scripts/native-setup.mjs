import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const targets = process.argv.slice(2);
const platforms = targets.length ? targets : ['android', 'ios'];
for (const platform of platforms) {
  if (!['android', 'ios'].includes(platform)) throw new Error('Expected android or ios');
  const result = spawnSync(
    process.execPath,
    ['node_modules/@capacitor/cli/bin/capacitor', 'sync', platform],
    { stdio: 'inherit' },
  );
  if (result.status) process.exit(result.status);
  if (platform === 'ios') {
    // Give this SPM dependency a unique directory identity without Windows symlink privileges.
    const vendor = resolve('ios/App/CapApp-SPM/vendor/CapacitorFirebaseMessaging');
    mkdirSync(vendor, { recursive: true });
    cpSync(
      resolve('node_modules/@capacitor-firebase/messaging/Package.swift'),
      vendor + '/Package.swift',
    );
    cpSync(resolve('node_modules/@capacitor-firebase/messaging/ios'), vendor + '/ios', {
      recursive: true,
    });
    const file = 'ios/App/CapApp-SPM/Package.swift';
    const source = readFileSync(file, 'utf8').replace(
      /\.package\(name: "CapacitorFirebaseMessaging", path: "[^"]*"\)/g,
      '.package(name: "CapacitorFirebaseMessaging", path: "vendor/CapacitorFirebaseMessaging")',
    );
    writeFileSync(file, source);
    console.log('iOS SPM messaging dependency prepared with a portable local path.');
  }
}
if (
  !existsSync('android/app/google-services.json') ||
  !existsSync('ios/App/App/GoogleService-Info.plist')
)
  console.log(
    'Mobile Firebase configuration is absent. See README.md; the app works without mobile push.',
  );
