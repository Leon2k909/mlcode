import { describe, expect, it } from "vite-plus/test";

import {
  PARTY_ACTIVITY_FRESH_MS,
  PARTY_INPUT_LIVE_MS,
  composePartyDetail,
  describePartyActivity,
  isAnyThreadWorking,
  resolvePartySurface,
} from "./party";

const NOW = Date.parse("2026-08-27T20:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe("resolvePartySurface", () => {
  it("names the coarse surface, never the route", () => {
    expect(resolvePartySurface("/settings/usage")).toBe("usage");
    expect(resolvePartySurface("/settings/friends")).toBe("settings");
    expect(resolvePartySurface("/projects/abc")).toBe("settings");
    expect(resolvePartySurface("/pull-requests")).toBe("pull-requests");
    expect(resolvePartySurface("/friends/f1/t1")).toBe("friends");
    expect(resolvePartySurface("/")).toBe("chat");
    expect(resolvePartySurface("/env-1/thread-1")).toBe("chat");
    expect(resolvePartySurface("/pair")).toBe("other");
  });
});

describe("composePartyDetail", () => {
  const threads = [{ id: "thread-1", projectId: "project-1", title: "Fix the auth flow" }] as never;
  const projectTitleById = new Map([["project-1", "germ"]]);

  it("labels a known thread with its project and title", () => {
    expect(composePartyDetail({ pathname: "/env-1/thread-1", threads, projectTitleById })).toBe(
      "germ › Fix the auth flow",
    );
  });

  it("sends no label for unknown paths - a friend never receives an id", () => {
    expect(
      composePartyDetail({ pathname: "/env-1/thread-unknown", threads, projectTitleById }),
    ).toBeUndefined();
  });

  it("sends no label off the chat surface", () => {
    expect(
      composePartyDetail({ pathname: "/settings/general", threads, projectTitleById }),
    ).toBeUndefined();
  });

  it("falls back to the bare title when the project is unknown", () => {
    expect(
      composePartyDetail({ pathname: "/env-1/thread-1", threads, projectTitleById: new Map() }),
    ).toBe("Fix the auth flow");
  });
});

describe("isAnyThreadWorking", () => {
  it("reads only a running latest turn as busy", () => {
    expect(isAnyThreadWorking([{ latestTurn: { state: "running" } }] as never)).toBe(true);
    expect(isAnyThreadWorking([{ latestTurn: { state: "completed" } }] as never)).toBe(false);
    expect(isAnyThreadWorking([{ latestTurn: null }] as never)).toBe(false);
  });
});

describe("describePartyActivity", () => {
  const activity = (overrides: Partial<Parameters<typeof describePartyActivity>[0]>) =>
    describePartyActivity(
      {
        surface: "chat",
        detail: "germ › Fix the auth flow",
        agentBusy: true,
        lastInputAt: iso(-5_000),
        updatedAt: iso(-10_000),
        ...overrides,
      },
      NOW,
    );

  it("shows a fresh, live, working friend in full", () => {
    expect(activity({})).toEqual({
      headline: "In germ › Fix the auth flow",
      fresh: true,
      inputLive: true,
      agentBusy: true,
    });
  });

  it("drops the input pulse once their hands leave the keyboard", () => {
    expect(activity({ lastInputAt: iso(-PARTY_INPUT_LIVE_MS - 1) }).inputLive).toBe(false);
  });

  it("fades everything when the beacon itself goes stale", () => {
    const stale = activity({ updatedAt: iso(-PARTY_ACTIVITY_FRESH_MS - 1) });
    expect(stale.fresh).toBe(false);
    expect(stale.inputLive).toBe(false);
    expect(stale.agentBusy).toBe(false);
  });

  it("labels detail-less surfaces by kind", () => {
    expect(activity({ detail: undefined, surface: "pull-requests" }).headline).toBe(
      "Reviewing pull requests",
    );
  });
});
