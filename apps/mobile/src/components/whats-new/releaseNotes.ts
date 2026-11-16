import { Schema } from "effect";

import {
  compareVersions,
  isVersionValid,
} from "@/components/providers/ForceUpdate/versionUtils";
import { DYNAMIC_CONFIGS, FEATURE_GATES } from "@/featureGates/names";

export const WHATS_NEW_GATE = FEATURE_GATES.showWhatsNew;
export const WHATS_NEW_CONFIG = DYNAMIC_CONFIGS.whatsNew;

const ReleaseText = Schema.String.check(Schema.isPattern(/\S/));
const ReleaseNotesSchema = Schema.Struct({
  version: Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/)),
  title: ReleaseText,
  description: ReleaseText,
  highlights: Schema.Array(
    Schema.Struct({
      icon: ReleaseText,
      title: ReleaseText,
      description: ReleaseText,
    }),
  ).check(Schema.isMinLength(1)),
});
export type ReleaseNotes = typeof ReleaseNotesSchema.Type;

export const decodeWhatsNewConfig = Schema.decodeUnknownOption(
  Schema.Struct({ release: ReleaseNotesSchema }),
);

// Offline fallback for manual visits only. Pin each entry to the release it
// describes; changing native-version.js must never create an announcement.
export const releases: readonly ReleaseNotes[] = [
  {
    version: "1.1.6",
    title: "More ways to feel at home",
    description: "A fresh look and a few thoughtful updates for your week.",
    highlights: [
      {
        icon: "compass",
        title: "A fresh look, made for you",
        description:
          "Explore your church with refreshed screens, simpler navigation, and light and dark themes.",
      },
      {
        icon: "church",
        title: "Your campus, closer",
        description:
          "Choose your campus in Profile to find its events, livestreams, and giving in one place.",
      },
      {
        icon: "bookmark",
        title: "Keep the words that speak to you",
        description:
          "Save verses and your personal words of activation to return to throughout the week.",
      },
    ],
  },
];

export function getConfiguredReleaseNotes(
  installedVersion: string | null | undefined,
  release: ReleaseNotes | undefined,
): ReleaseNotes | undefined {
  if (!installedVersion || !isVersionValid(installedVersion)) {
    return undefined;
  }
  if (!release || compareVersions(release.version, installedVersion) > 0) {
    return undefined;
  }
  return release;
}

export function getReleaseNotes(
  installedVersion: string | null | undefined,
): ReleaseNotes | undefined {
  if (!installedVersion || !isVersionValid(installedVersion)) {
    return undefined;
  }
  // An OTA update can include notes for a newer binary. Only describe features
  // available in the installed app, including when someone skips a release.
  return releases.find(
    (release) => compareVersions(release.version, installedVersion) <= 0,
  );
}

export function isReleaseUnseen(
  release: ReleaseNotes | undefined,
  lastSeenVersion: string | null | undefined,
): boolean {
  return Boolean(
    release &&
    (!lastSeenVersion ||
      !isVersionValid(lastSeenVersion) ||
      compareVersions(lastSeenVersion, release.version) < 0),
  );
}
