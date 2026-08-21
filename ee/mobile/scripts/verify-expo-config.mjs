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
