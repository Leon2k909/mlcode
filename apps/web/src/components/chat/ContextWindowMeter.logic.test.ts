import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  formatContextWindowCompactionMessage,
  resolveContextWindowFastMode,
  resolveContextWindowModelDisplayName,
} from "./ContextWindowMeter.logic";

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
