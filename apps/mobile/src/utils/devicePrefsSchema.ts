import { Schema } from "effect";

import {
  DateFromStringOrDate,
  EmailString,
  nullableOptional,
} from "@/utils/effectSchema";

export const THEME_VALUES = ["purple-light", "purple-dark", "auto"] as const;
export const DEFAULT_THEME = "auto";
export type DynamicTheme = (typeof THEME_VALUES)[number];

export const LATEST_DEVICE_PREFS_VERSION = 2;

const SignInWithCodeEmailSchema = Schema.Struct({
  email: nullableOptional(EmailString),
  expiresTimestampMs: nullableOptional(Schema.Number),
});

export const DevicePrefsSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  // Theme preference (persists across sessions)
  theme: nullableOptional(Schema.Literals(THEME_VALUES)),
  // Sound enabled preference
  soundEnabled: nullableOptional(Schema.Boolean),
  // Campus location ID (device-specific selection)
  campusLocationId: nullableOptional(Schema.String),
  // Transient sign-in state (for code-based auth flow)
  signInWithCodeEmail: nullableOptional(SignInWithCodeEmailSchema),
  // Transient delete account request state
  deleteAccountRequest: nullableOptional(SignInWithCodeEmailSchema),
  // Statsig features the user has opted into
  optInFeatures: nullableOptional(Schema.Array(Schema.String)),
  // Track if user was previously authenticated (survives app restart)
  // Used to know whether to wait for Firebase auth to restore on app launch
  wasAuthenticated: nullableOptional(Schema.Boolean),
  notificationPromptHasVisitedHome: nullableOptional(Schema.Boolean),
  notificationPromptHandled: nullableOptional(Schema.Boolean),
  // Notification category channels this device turned off; others stay on.
  notificationCategoriesOff: nullableOptional(Schema.Array(Schema.String)),
  // Campuses whose livestreams this device follows besides its own campus.
  followedCampusSlugs: nullableOptional(Schema.Array(Schema.String)),
  // Device-scoped release acknowledgment; survives sign-out.
  whatsNewLastSeenVersion: nullableOptional(Schema.String),
  // Creation timestamp
  createdAt: DateFromStringOrDate,
  // Schema version for migrations
  version: nullableOptional(Schema.Number),
});

export type DevicePrefsDoc = typeof DevicePrefsSchema.Type;
