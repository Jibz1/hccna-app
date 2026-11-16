import { expectTypeOf, test } from "vitest";

import type { DynamicConfigName, FeatureGateName } from "@/featureGates/names";

import type { statsig } from "./statsig";

type Client = typeof statsig;

// Type-only checks: `bun run typecheck` fails if the proxy accepts an unregistered
// gate or config name, or exposes a raw lookup that takes any name.
test("the statsig proxy only reads registered gate and config names", () => {
  expectTypeOf<
    Parameters<Client["checkGate"]>[0]
  >().toEqualTypeOf<FeatureGateName>();
  expectTypeOf<
    Parameters<Client["getDynamicConfig"]>[0]
  >().toEqualTypeOf<DynamicConfigName>();
  expectTypeOf<Client>().not.toHaveProperty("getFeatureGate");
  expectTypeOf<Client>().not.toHaveProperty("getExperiment");
  expectTypeOf<Client>().not.toHaveProperty("getLayer");
});
