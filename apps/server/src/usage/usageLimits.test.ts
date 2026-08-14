import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";

import { normalizeUsageLimits } from "./usageLimits.ts";

describe("normalizeUsageLimits", () => {
  it("normalizes Codex session and weekly windows", () => {
    expect(
      normalizeUsageLimits(
        ProviderDriverKind.make("codex"),
        {
          rateLimits: {
            primary: { usedPercent: 42, resetsAt: 1_800_000_000 },
            secondary: { usedPercent: 73, resetsAt: 1_800_100_000 },
          },
        },
        "2026-08-14T08:00:00.000Z",
      ),
    ).toEqual({
      provider: "codex",
      readAt: "2026-08-14T08:00:00.000Z",
      status: null,
      windows: [
        { label: "Session", usedPercent: 42, resetsAt: 1_800_000_000 },
        { label: "Weekly", usedPercent: 73, resetsAt: 1_800_100_000 },
      ],
    });
  });

  it("normalizes Claude fractional utilization and its reset", () => {
    expect(
      normalizeUsageLimits(
        ProviderDriverKind.make("claudeAgent"),
        {
          rate_limit_info: {
            status: "allowed_warning",
            rateLimitType: "five_hour",
            utilization: 0.64,
            resetsAt: 1_800_000_000,
          },
        },
        "2026-08-14T08:00:00.000Z",
      ),
    ).toEqual({
      provider: "claude",
      readAt: "2026-08-14T08:00:00.000Z",
      status: "allowed_warning",
      windows: [{ label: "5-hour", usedPercent: 64, resetsAt: 1_800_000_000 }],
    });
  });
});
