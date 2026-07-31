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

// play-services-code-scanner (bundled by expo-camera) declares this activity with
// android:screenOrientation="portrait", which Play Console flags as a large-screen
// restriction. We never launch it (no launchScannerAsync usage), so lift the lock.
const GMS_SCANNER_ACTIVITY =
  'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity';

function withGmsScannerOrientationFix(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults.manifest.$ = cfg.modResults.manifest.$ || {};
    cfg.modResults.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    application.activity = application.activity || [];

    let activity = application.activity.find(
      (item) => item.$?.['android:name'] === GMS_SCANNER_ACTIVITY
    );
    if (!activity) {
      activity = { $: { 'android:name': GMS_SCANNER_ACTIVITY } };
      application.activity.push(activity);
    }
    activity.$['android:screenOrientation'] = 'fullUser';
    activity.$['tools:replace'] = 'android:screenOrientation';

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
  config = withGmsScannerOrientationFix(config);
  config = withCleanEdgeToEdgeStyles(config);
  return config;
};
