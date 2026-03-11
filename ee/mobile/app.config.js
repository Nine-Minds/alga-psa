const path = require('path');

const appJson = require('./app.json');

function resolveAsset(filename) {
  return path.resolve(__dirname, 'assets', filename);
}

module.exports = {
  expo: {
    ...appJson.expo,
    icon: resolveAsset('icon.png'),
    splash: {
      ...appJson.expo.splash,
      image: resolveAsset('splash-icon.png'),
    },
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
  },
};
