import { expect, it } from "vitest";

import { fingerprintReport } from "./fingerprint-report";

it("confirms a PR without native changes", () => {
  expect(fingerprintReport([])).toEqual({
    summary: "No native changes: this can ship as an OTA update.",
  });
});

it("warns and lists the native sources a PR changes", () => {
  const diff = [
    {
      op: "added",
      addedSource: {
        type: "dir",
        filePath: "node_modules/react-native-example",
        reasons: ["expoAutolinkingIos"],
        hash: "a",
      },
    },
    {
      op: "changed",
      beforeSource: {
        type: "contents",
        id: "expoConfig",
        contents: "{}",
        reasons: [],
        hash: "b",
      },
      afterSource: {
        type: "contents",
        id: "expoConfig",
        contents: "{}",
        reasons: [],
        hash: "c",
      },
    },
    {
      op: "removed",
      removedSource: {
        type: "file",
        filePath: "plugins/withExample.js",
        reasons: [],
        hash: "d",
      },
    },
  ];
  const report = fingerprintReport(diff);
  expect(report.warning).toBe(
    "This PR changes native code, so it can't ship as an OTA update. Release it with `bun run version:bump store` and a store build.",
  );
  expect(report.summary).toContain(
    "- added: node_modules/react-native-example",
  );
  expect(report.summary).toContain("- changed: expoConfig");
  expect(report.summary).toContain("- removed: plugins/withExample.js");
});
