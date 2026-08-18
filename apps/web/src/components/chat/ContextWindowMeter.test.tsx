import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { ContextWindowMeter } from "./ContextWindowMeter";

describe("ContextWindowMeter", () => {
  it("keeps a stable, non-interactive placeholder while waiting for fresh usage", () => {
    const markup = renderToStaticMarkup(<ContextWindowMeter usage={null} />);

    expect(markup).toContain('aria-label="Waiting for fresh context usage"');
    expect(markup).not.toContain("Context Window");
  });
});
