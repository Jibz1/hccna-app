import { expect, test } from "vitest";

import { DYNAMIC_CONFIGS, FEATURE_GATES } from "./names";

test("gate names match the Statsig console", () => {
  expect(FEATURE_GATES).toEqual({
    shortsFeed: "shorts_feed",
    notificationSettings: "notification_settings_enabled",
    showWhatsNew: "show_whats_new",
    pushTokenOutbox: "push_token_outbox_enabled",
    ensureUserProfile: "ensure_user_profile_enabled",
    relayPersistenceKillSwitch: "relay_persistence_killswitch",
  });
});

test("config names match the Statsig console", () => {
  expect(DYNAMIC_CONFIGS).toEqual({
    backendGraphqlEndpoint: "backend_graphql_endpoint",
    sentrySampleRate: "sentry-sample-rate",
    relayRevalidation: "relay_revalidation_config",
    whatsNew: "whats_new",
    forcedUpdate: "forced-update",
  });
});

test("no name is used twice", () => {
  const names = [
    ...Object.values(FEATURE_GATES),
    ...Object.values(DYNAMIC_CONFIGS),
  ];
  expect(new Set(names).size).toBe(names.length);
});
