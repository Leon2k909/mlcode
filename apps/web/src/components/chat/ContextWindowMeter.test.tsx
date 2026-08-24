import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { ContextManagementControls, ContextWindowMeter } from "./ContextWindowMeter";

describe("ContextWindowMeter", () => {
  it("keeps the usage trigger clickable while waiting for fresh usage", () => {
    const markup = renderToStaticMarkup(<ContextWindowMeter usage={null} />);

    expect(markup).toContain('aria-label="Context window usage unavailable"');
    expect(markup).toContain("<button");
  });

  it("renders the environment long-thread choices without changing manual defaults", () => {
    const markup = renderToStaticMarkup(
      <ContextManagementControls
        contextManagementMode="auto-new-thread"
        savingMode={null}
        modeSaveFailed={false}
        onContextManagementModeChange={() => undefined}
      />,
    );

    expect(markup).toContain("Long threads");
    expect(markup).toContain("Auto-delete");
    expect(markup).toContain("New chat");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("act at 75%");
  });
});
