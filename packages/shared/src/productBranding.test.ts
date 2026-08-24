import { describe, expect, it } from "vite-plus/test";

import { displayMlCodeProjectName } from "./productBranding.ts";

describe("displayMlCodeProjectName", () => {
  it.each([
    "t3code",
    "T3 Code",
    "mlcode",
    "ML Code",
    "pingdotgg/t3code",
    "github.com/pingdotgg/t3code",
    "Leon2k909/mlcode",
    "github.com/leon2k909/mlcode",
  ])("normalizes the known product repository label %s", (label) => {
    expect(displayMlCodeProjectName(label)).toBe("ML Code");
  });

  it("leaves unrelated repositories unchanged", () => {
    expect(displayMlCodeProjectName("another-owner/t3code")).toBe("another-owner/t3code");
  });
});
