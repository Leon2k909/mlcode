import { describe, expect, it } from "vite-plus/test";
import {
  EMPLOYEE_MODEL_AUTO,
  EMPLOYEE_MODEL_CUSTOM,
  EMPLOYEE_MODEL_FOLLOW_THREAD,
  getEmployeeModelPickerLabel,
} from "./EmployeeSettingsPanel.logic";

const modelOptions = [
  { slug: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
  { slug: "claude-fable-5", name: "Claude Fable 5" },
];

describe("getEmployeeModelPickerLabel", () => {
  it("renders the auto routing sentinel as Auto", () => {
    expect(getEmployeeModelPickerLabel(EMPLOYEE_MODEL_AUTO, modelOptions)).toBe("Auto");
  });

  it("renders the remaining internal sentinels as user-facing labels", () => {
    expect(getEmployeeModelPickerLabel(EMPLOYEE_MODEL_FOLLOW_THREAD, modelOptions)).toBe(
      "Follow chat model",
    );
    expect(getEmployeeModelPickerLabel(EMPLOYEE_MODEL_CUSTOM, modelOptions)).toBe(
      "Custom model slug…",
    );
  });

  it("uses the provider model name for a known model value", () => {
    expect(getEmployeeModelPickerLabel("gpt-5.6-luna", modelOptions)).toBe("GPT-5.6 Luna");
  });

  it("falls back to the model slug when provider metadata is unavailable", () => {
    expect(getEmployeeModelPickerLabel("custom-model", modelOptions)).toBe("custom-model");
  });
});
