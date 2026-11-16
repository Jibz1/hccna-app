/**
 * Every Statsig gate and dynamic config name the app reads. The names are
 * deployed in the Statsig console: renaming one silently turns its feature
 * off, so change a value here only together with the console.
 */
export const FEATURE_GATES = {
  shortsFeed: "shorts_feed",
  notificationSettings: "notification_settings_enabled",
  showWhatsNew: "show_whats_new",
  pushTokenOutbox: "push_token_outbox_enabled",
  ensureUserProfile: "ensure_user_profile_enabled",
  relayPersistenceKillSwitch: "relay_persistence_killswitch",
} as const;
export type FeatureGateName =
  (typeof FEATURE_GATES)[keyof typeof FEATURE_GATES];

export const DYNAMIC_CONFIGS = {
  backendGraphqlEndpoint: "backend_graphql_endpoint",
  sentrySampleRate: "sentry-sample-rate",
  relayRevalidation: "relay_revalidation_config",
  whatsNew: "whats_new",
  forcedUpdate: "forced-update",
} as const;
export type DynamicConfigName =
  (typeof DYNAMIC_CONFIGS)[keyof typeof DYNAMIC_CONFIGS];
