import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  formatContextWindowCompactionMessage,
  resolveContextWindowFastMode,
  resolveContextWindowModelDisplayName,
  selectOldestMessageIdsForPruning,
  shouldOfferContextPrune,
} from "./ContextWindowMeter.logic";

describe("context pruning guidance", () => {
  it("offers pruning once a long thread reaches half of its context window", () => {
    expect(shouldOfferContextPrune({ usedPercentage: 49, messageCount: 20 })).toBe(false);
    expect(shouldOfferContextPrune({ usedPercentage: 50, messageCount: 9 })).toBe(false);
    expect(shouldOfferContextPrune({ usedPercentage: 50, messageCount: 10 })).toBe(true);
    expect(shouldOfferContextPrune({ usedPercentage: null, messageCount: 20 })).toBe(false);
  });

  it("selects old non-system messages while retaining the latest four user turns", () => {
    const messages = Array.from({ length: 6 }, (_, index) => [
      { id: `user-${index}`, role: "user" as const },
      { id: `assistant-${index}`, role: "assistant" as const },
    ]).flat();

    expect(selectOldestMessageIdsForPruning(messages)).toEqual([
      "user-0",
      "assistant-0",
      "user-1",
      "assistant-1",
    ]);
  });

  it("never selects system messages or a partial tail", () => {
    expect(
      selectOldestMessageIdsForPruning([
        { id: "system", role: "system" },
        { id: "user-0", role: "user" },
        { id: "assistant-0", role: "assistant" },
        { id: "user-1", role: "user" },
        { id: "assistant-1", role: "assistant" },
        { id: "user-2", role: "user" },
        { id: "assistant-2", role: "assistant" },
        { id: "user-3", role: "user" },
        { id: "assistant-3", role: "assistant" },
        { id: "user-4", role: "user" },
        { id: "assistant-4", role: "assistant" },
      ]),
    ).toEqual(["user-0", "assistant-0"]);
  });
});

describe("resolveContextWindowModelDisplayName", () => {
  it("uses the selected model from the exact provider instance", () => {
    const selectedInstanceId = ProviderInstanceId.make("codex-work");
    const modelOptionsByInstance = new Map([
      [selectedInstanceId, [{ slug: "gpt-5.6-sol", name: "GPT-5.6 Sol", shortName: "5.6 Sol" }]],
    ]);

    expect(
      resolveContextWindowModelDisplayName(
        { instanceId: selectedInstanceId, model: "gpt-5.6-sol" },
        modelOptionsByInstance,
      ),
    ).toBe("5.6 Sol");
  });

  it("falls back to the selected model slug when metadata is unavailable", () => {
    const selectedInstanceId = ProviderInstanceId.make("codex-work");

    expect(
      resolveContextWindowModelDisplayName(
        { instanceId: selectedInstanceId, model: "custom-model" },
        new Map(),
      ),
    ).toBe("custom-model");
  });
});

describe("formatContextWindowCompactionMessage", () => {
  it("describes compaction in terms of the selected model", () => {
    expect(formatContextWindowCompactionMessage("GPT-5.6 Sol")).toBe(
      "Context for GPT-5.6 Sol compacts automatically when needed.",
    );
  });

  it("uses neutral copy when the model is unavailable", () => {
    expect(formatContextWindowCompactionMessage(null)).toBe(
      "Context compacts automatically when needed.",
    );
  });
});

describe("resolveContextWindowFastMode", () => {
  it("uses the explicit fast mode option when present", () => {
    expect(
      resolveContextWindowFastMode({
        instanceId: ProviderInstanceId.make("codex-work"),
        model: "gpt-5.6-sol",
        options: [{ id: "fastMode", value: true }],
      }),
    ).toBe(true);
    expect(
      resolveContextWindowFastMode({
        instanceId: ProviderInstanceId.make("codex-work"),
        model: "gpt-5.6-sol",
        options: [{ id: "fastMode", value: false }],
      }),
    ).toBe(false);
  });

  it("recognizes Codex service tiers and leaves unsupported values unknown", () => {
    const selection = {
      instanceId: ProviderInstanceId.make("codex-work"),
      model: "gpt-5.6-sol",
    };
    expect(
      resolveContextWindowFastMode(
        { ...selection, options: [{ id: "serviceTier", value: "fast" }] },
        "Codex",
      ),
    ).toBe(true);
    expect(
      resolveContextWindowFastMode(
        { ...selection, options: [{ id: "serviceTier", value: "default" }] },
        "Codex",
      ),
    ).toBe(false);
    expect(
      resolveContextWindowFastMode(
        { ...selection, options: [{ id: "serviceTier", value: "default" }] },
        "Claude",
      ),
    ).toBe(null);
    expect(resolveContextWindowFastMode(selection)).toBe(null);
  });
});
