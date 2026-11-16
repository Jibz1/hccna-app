import { describe, expect, it } from "vitest";

import { resolveTrustedAppsBackendUrl } from "@/utils/backendUrl";

describe("resolveTrustedAppsBackendUrl", () => {
  it.each([
    ["https://api.hccnj.org", "https://api.hccnj.org"],
    ["https://hccnj.org/", "https://hccnj.org"],
    ["https://hccna.stellate.sh", "https://hccna.stellate.sh"],
    ["https://hccna.stellate.sh/", "https://hccna.stellate.sh"],
  ])("trusts %s as %s", (input, expected) => {
    expect(resolveTrustedAppsBackendUrl(input)).toBe(expected);
  });

  it.each([
    "http://api.hccnj.org",
    "https://attacker.example",
    "https://hccnj.org.attacker.example",
    "https://user:password@api.hccnj.org",
    "https://api.hccnj.org:8443",
    "https://api.hccnj.org?redirect=https://attacker.example",
    "https://api.hccnj.org#attacker",
    "not-a-url",
    // Only the hccna service's own edge host is trusted, not other stellate.sh tenants.
    "https://stellate.sh",
    "https://attacker.stellate.sh",
    "https://xhccna.stellate.sh",
    "https://hccna.stellate.sh.attacker.example",
    "http://hccna.stellate.sh",
    "https://hccna.stellate.sh:8443",
    "https://user:password@hccna.stellate.sh",
    "https://hccna.stellate.sh?redirect=https://attacker.example",
  ])("rejects an untrusted endpoint: %s", (input) => {
    expect(resolveTrustedAppsBackendUrl(input)).toBeNull();
  });
});
