import { readFile } from 'node:fs/promises';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
}

let config;
try {
  config = JSON.parse(input);
} catch {
  throw new Error('Expo did not produce valid JSON configuration');
}

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);

if (config.version !== packageJson.version) {
  throw new Error(
    `Expo version ${config.version ?? '<missing>'} does not match package version ${packageJson.version}`,
  );
}

const iosBuildNumber = Number(config.ios?.buildNumber);
if (!Number.isInteger(iosBuildNumber) || iosBuildNumber < 30) {
  throw new Error('iOS buildNumber must be an integer at or above 30');
}

const androidVersionCode = config.android?.versionCode;
if (!Number.isInteger(androidVersionCode) || androidVersionCode < 30) {
  throw new Error('Android versionCode must be an integer at or above 30');
}

// Apple only fills the iPhone Duo inner display, and Android 17 only honours a
// resizable window, when the app ships unlocked. Keep these from regressing if a
// future `expo install --fix` or template merge re-introduces the portrait lock.
if (config.orientation && config.orientation !== 'default') {
  throw new Error(
    `Expo orientation must stay unlocked ("default"), found "${config.orientation}"`,
  );
}

if (config.ios?.supportsTablet !== true) {
  throw new Error('iOS supportsTablet must stay enabled for large-screen layouts');
}

const buildProperties = config.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
);
for (const key of ['compileSdkVersion', 'targetSdkVersion']) {
  const sdkVersion = buildProperties?.[1]?.android?.[key];
  if (!Number.isInteger(sdkVersion) || sdkVersion < 37) {
    throw new Error(
      `Android ${key} must be an integer at or above 37 so Android 17 treats the app as resizable, found ${sdkVersion ?? '<missing>'}`,
    );
  }
}

const androidPermissions = config.android?.permissions ?? [];
if (androidPermissions.includes('android.permission.RECORD_AUDIO')) {
  throw new Error('Android RECORD_AUDIO permission must not be included');
}

const cameraPlugin = config.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-camera',
);
if (
  !cameraPlugin ||
  cameraPlugin[1]?.recordAudioAndroid !== false ||
  cameraPlugin[1]?.microphonePermission !== false
) {
  throw new Error('Expo Camera audio recording and microphone access must be disabled');
}

console.log(
  `Expo config verified: ${config.version}, iOS ${iosBuildNumber}, Android ${androidVersionCode}`,
);
