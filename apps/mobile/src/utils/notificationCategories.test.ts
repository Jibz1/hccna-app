import { expect, test } from "vitest";

import {
  notificationChannels,
  setFollowedCampus,
  setNotificationCategory,
} from "./notificationCategories";

test("registers the settings marker with every category a device kept on", () => {
  expect(notificationChannels(undefined)).toEqual([
    "notify-prefs-v1",
    "verse-of-the-day",
    "livestreams",
    "word-of-activation",
  ]);
  expect(notificationChannels(["livestreams"])).toEqual([
    "notify-prefs-v1",
    "verse-of-the-day",
    "word-of-activation",
  ]);
});

test("stores categories as an opt-out list", () => {
  const off = setNotificationCategory(null, "livestreams", false);
  expect(off).toEqual(["livestreams"]);
  expect(setNotificationCategory(off, "livestreams", false)).toEqual([
    "livestreams",
  ]);
  expect(setNotificationCategory(off, "livestreams", true)).toEqual([]);
});

test("adds a follow channel for each followed campus", () => {
  const followed = setFollowedCampus(null, "new-breed", true);
  expect(notificationChannels(["livestreams"], followed)).toEqual([
    "notify-prefs-v1",
    "verse-of-the-day",
    "word-of-activation",
    "follow-new-breed",
  ]);
  expect(setFollowedCampus(followed, "new-breed", false)).toEqual([]);
});

test("leaves the device's own campus to the Livestreams category", () => {
  expect(
    notificationChannels(
      ["livestreams"],
      ["light-house", "new-breed"],
      "new-breed",
    ),
  ).toEqual([
    "notify-prefs-v1",
    "verse-of-the-day",
    "word-of-activation",
    "follow-light-house",
  ]);
});
