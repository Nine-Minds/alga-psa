const path = require('path');

const appJson = require('./app.json');

function resolveAsset(filename) {
  return path.resolve(__dirname, 'assets', filename);
}

// SDK 56 dropped the classic `splash` config field; the splash asset now lives in
// the expo-splash-screen plugin props and still needs an absolute path.
function resolvePluginAssets(plugin) {
  if (Array.isArray(plugin) && plugin[0] === 'expo-splash-screen') {
    return [plugin[0], { ...plugin[1], image: resolveAsset('splash-icon.png') }];
  }
  return plugin;
}

module.exports = {
  expo: {
    ...appJson.expo,
    icon: resolveAsset('icon.png'),
    android: {
      ...appJson.expo.android,
      adaptiveIcon: {
        ...appJson.expo.android?.adaptiveIcon,
        foregroundImage: resolveAsset('adaptive-icon.png'),
      },
    },
    web: {
      ...appJson.expo.web,
      favicon: resolveAsset('favicon.png'),
    },
    plugins: [
      ...(appJson.expo.plugins ?? []).map(resolvePluginAssets),
      './plugins/withAndroidLargeScreenSupport.js',
    ],
  },
};
