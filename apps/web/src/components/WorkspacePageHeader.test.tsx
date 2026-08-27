import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { WorkspacePageHeader } from "./WorkspacePageHeader";

/**
 * Both gutters in this header are reservations for window chrome that exists
 * once per window, not once per pane: the OS window controls on the right and
 * the floating sidebar toggle on the left. A split view renders one header per
 * pane, so each reservation has to be opt-in or the panes that are nowhere
 * near that chrome give up space for it anyway.
 */
describe("WorkspacePageHeader", () => {
  const markup = (props: Parameters<typeof WorkspacePageHeader>[0]) =>
    renderToStaticMarkup(<WorkspacePageHeader {...props} />);

  it("reserves the window-control gutter only for the pane that owns the titlebar", () => {
    expect(markup({ electron: true, reserveNativeControls: true })).toContain(
      "wco:pr-[var(--workspace-native-controls-inset)]",
    );
    expect(markup({ electron: true, reserveNativeControls: false })).not.toContain(
      "wco:pr-[var(--workspace-native-controls-inset)]",
    );
  });

  it("reserves the collapsed-sidebar toggle gutter only for the leftmost pane", () => {
    expect(markup({ electron: true })).toContain("--workspace-titlebar-content-left");
    expect(markup({ electron: true, reserveSidebarToggle: false })).not.toContain(
      "--workspace-titlebar-content-left",
    );
  });

  it("measures the window-control gutter instead of hardcoding a width", () => {
    // A fixed padding cannot track the real titlebar area, and stacked with
    // the measured one it pushed the header actions out of reach.
    expect(markup({ electron: true, reserveNativeControls: true })).not.toMatch(/\bpr-16\b/);
  });
});
