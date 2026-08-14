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
            planType: "pro",
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
      plan: "Pro",
      windows: [
        { label: "Session", usedPercent: 42, resetsAt: 1_800_000_000 },
        { label: "Weekly", usedPercent: 73, resetsAt: 1_800_100_000 },
      ],
    });
  });

  it("normalizes Codex spend limits from the account snapshot", () => {
    expect(
      normalizeUsageLimits(
        ProviderDriverKind.make("codex"),
        {
          rateLimits: { planType: "plus" },
          rateLimitsByLimitId: {
            codex: {
              planType: "plus",
              primary: { usedPercent: 18, resetsAt: 1_800_000_000 },
              individualLimit: {
                limit: "100",
                remainingPercent: 64,
                resetsAt: 1_800_200_000,
                used: "36",
              },
            },
          },
        },
        "2026-08-14T08:00:00.000Z",
      ),
    ).toEqual({
      provider: "codex",
      readAt: "2026-08-14T08:00:00.000Z",
      status: null,
      plan: "Plus",
      windows: [
        { label: "Session", usedPercent: 18, resetsAt: 1_800_000_000 },
        { label: "Spend limit", usedPercent: 36, resetsAt: 1_800_200_000 },
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

  it("keeps Claude subscription status when utilization is omitted", () => {
    expect(
      normalizeUsageLimits(
        ProviderDriverKind.make("claudeAgent"),
        {
          rate_limit_info: {
            status: "allowed",
            rateLimitType: "max_plan",
            overageStatus: "allowed",
            overageResetsAt: 1_800_100_000,
          },
        },
        "2026-08-14T08:00:00.000Z",
      ),
    ).toEqual({
      provider: "claude",
      readAt: "2026-08-14T08:00:00.000Z",
      status: "allowed",
      plan: "Max",
      windows: [{ label: "Max plan", resetsAt: null }],
    });
  });
});
