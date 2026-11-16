import { describe, expect, test } from "vitest";

import { resolveUserProfile } from "@/relay/userData";

describe("Relay user data", () => {
  test("accepts only the profile for the initiating authenticated UID", () => {
    const result = {
      user: {
        profile: {
          ccbFamilyId: null,
          campusPreferenceVersion: 0,
          preferredCampusSlug: null,
          ccbId: null,
          createdAt: null,
          departments: null,
          uid: "user-a",
          email: "user-a@example.com",
          enrichmentPending: false,
          firstName: null,
          img: null,
          isVerified: null,
          lastName: null,
          phone: null,
          provider: null,
        },
      },
    };

    expect(resolveUserProfile(result, "user-a")?.email).toBe(
      "user-a@example.com",
    );
    expect(resolveUserProfile(result, "user-b")).toBeNull();
    expect(resolveUserProfile(result, null)).toBeNull();
  });
});
