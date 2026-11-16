const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

// Points incoming FCM notification-messages at the "default" channel the app
// creates at runtime (usePushNotifications.ts). Without this meta-data the
// merged manifest ships an empty channel id and Android falls back to the
// Miscellaneous channel.
module.exports = function withAndroidFcmDefaultChannel(config) {
  return withAndroidManifest(config, (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults,
    );
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      mainApplication,
      "com.google.firebase.messaging.default_notification_channel_id",
      "default",
    );
    return config;
  });
};
