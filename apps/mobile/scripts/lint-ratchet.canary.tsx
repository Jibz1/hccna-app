/**
 * Lint ratchet canary. Never built, imported or run.
 *
 * It holds exactly one violation of each of the six ratcheted `mobile/` rules.
 * `oxlint.config.mjs` ignores it in the normal lint run and lints it only when
 * `MOBILE_LINT_RATCHET=1`. `scripts/lint-ratchet.ts` then requires a diagnostic
 * from every rule here before it compares or writes the baseline, so a rule that
 * stops reporting fails the lint instead of silently emptying its baseline.
 * Keep one violation per rule; never fix them.
 */
import { onAuthStateChanged } from "@react-native-firebase/auth";
import { useFeatureGate } from "@statsig/expo-bindings";
import { atom } from "jotai";
import { useEffect } from "react";
import { useMutation } from "react-relay";

export const canaryImports = [
  onAuthStateChanged,
  useFeatureGate,
  atom,
  useMutation,
];

export function Canary() {
  useEffect(() => undefined, []);
  return null;
}

export const canaryTimer = () => setTimeout(() => undefined, 0);
