import { expect, test } from "vitest";

import { assertMutationSucceeded, MutationFailedError } from "./mutationResult";

const fallback = "Unable to save";

test("passes when success is true and there are no errors", () => {
  expect(() => {
    assertMutationSucceeded({ success: true }, null, fallback);
  }).not.toThrow();
  expect(() => {
    assertMutationSucceeded({ success: true }, [], fallback);
  }).not.toThrow();
});

test.each([
  [
    "success false with a message",
    { success: false, message: "Not allowed" },
    null,
    "Not allowed",
  ],
  ["success false without a message", { success: false }, null, fallback],
  ["success null", { success: null, message: null }, null, fallback],
  ["missing payload", null, null, fallback],
  ["undefined payload", undefined, undefined, fallback],
  [
    "GraphQL error despite success",
    { success: true },
    [{ message: "Boom" }],
    "Boom",
  ],
] as const)("rejects %s", (_name, payload, errors, message) => {
  expect(() => {
    assertMutationSucceeded(payload, errors, fallback);
  }).toThrow(new MutationFailedError(message));
});
