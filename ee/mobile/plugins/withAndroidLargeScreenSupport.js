const { withAndroidManifest, withAndroidStyles, AndroidConfig } = require('@expo/config-plugins');

function withMainActivityOrientation(config) {
  return withAndroidManifest(config, (cfg) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    mainActivity.$ = mainActivity.$ || {};

    mainActivity.$['android:screenOrientation'] = 'fullUser';
    mainActivity.$['android:resizeableActivity'] = 'true';

    return cfg;
  });
}

function withCleanEdgeToEdgeStyles(config) {
  return withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults?.resources?.style ?? [];
    const deprecatedItems = new Set([
      'android:statusBarColor',
      'android:navigationBarColor',
      'android:enforceNavigationBarContrast',
      'android:enforceStatusBarContrast',
    ]);

    for (const style of styles) {
      if (!Array.isArray(style.item)) continue;
      style.item = style.item.filter((item) => !deprecatedItems.has(item.$?.name));
    }

    return cfg;
  });
}

module.exports = function withAndroidLargeScreenSupport(config) {
  config = withMainActivityOrientation(config);
  config = withCleanEdgeToEdgeStyles(config);
  return config;
};
