import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  chatHeaderActionsReserveClass,
  resolveRenameCommit,
  shouldShowOpenInPicker,
} from "./ChatHeader";

/**
 * The floating panel-layout toggles overlay the header's right end while the
 * right panel is closed. The actions row must reserve their footprint - the
 * old pr-16 was this reservation, and removing it put the toggles on top of
 * the Sync/Push control.
 */
describe("chatHeaderActionsReserveClass", () => {
  it("reserves nothing while the toggles live in the right panel instead", () => {
    expect(
      chatHeaderActionsReserveClass({
        panelControlsFloating: false,
        nativeControlsReserved: true,
      }),
    ).toBeUndefined();
  });

  it("reserves the cluster footprint beyond the controls offset", () => {
    expect(
      chatHeaderActionsReserveClass({
        panelControlsFloating: true,
        nativeControlsReserved: false,
      }),
    ).toBe("pr-[calc(var(--workspace-controls-right)+var(--workspace-panel-controls-reserve))]");
  });

  it("subtracts the native gutter the outer header already reserved", () => {
    // In overlay mode --workspace-controls-right contains the native
    // window-control area; padding it again would double the gutter.
    expect(
      chatHeaderActionsReserveClass({
        panelControlsFloating: true,
        nativeControlsReserved: true,
      }),
    ).toBe(
      "pr-[calc(var(--workspace-controls-right)+var(--workspace-panel-controls-reserve)-var(--workspace-native-controls-inset))]",
    );
  });
});

describe("shouldShowOpenInPicker", () => {
  const primaryEnvironmentId = EnvironmentId.make("environment-primary");

  it("shows the picker for projects in the primary environment", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(true);
  });

  it("shows the picker for remote environments in deep-link mode", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId,
        remoteOpenMode: "remote-links",
      }),
    ).toBe(true);
  });

  it("shows the picker's unavailable state for remote environments without an SSH route", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId: null,
        remoteOpenMode: "remote-unavailable",
      }),
    ).toBe(true);
  });

  it("hides the picker for non-primary local backends", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(false);
  });

  it("hides the picker when there is no active project", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: undefined,
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
        remoteOpenMode: "remote-links",
      }),
    ).toBe(false);
  });
});

describe("resolveRenameCommit", () => {
  it("commits a trimmed changed title", () => {
    expect(resolveRenameCommit({ title: "  New title ", originalTitle: "Old" })).toEqual({
      action: "commit",
      title: "New title",
    });
  });

  it("rejects empty and whitespace-only titles", () => {
    expect(resolveRenameCommit({ title: "   ", originalTitle: "Old" })).toEqual({
      action: "reject-empty",
    });
  });

  it("no-ops when the trimmed title is unchanged", () => {
    expect(resolveRenameCommit({ title: " Old ", originalTitle: "Old" })).toEqual({
      action: "noop",
    });
  });
});
