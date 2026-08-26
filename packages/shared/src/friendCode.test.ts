import { describe, expect, it } from "@effect/vitest";

import { encodeFriendCode, looksLikeFriendCode, parseFriendCode } from "./friendCode.ts";

const contents = {
  environmentId: "env-alice",
  displayName: "Alice",
  avatarColor: "purple" as const,
  httpBaseUrl: "http://192.168.1.20:3773",
  token: "one-time-token",
};

describe("friend codes", () => {
  it("round-trips everything the invitee needs", () => {
    const parsed = parseFriendCode(encodeFriendCode(contents));
    expect(parsed).toEqual({ ok: true, contents });
  });

  it("survives being pasted with surrounding whitespace", () => {
    const parsed = parseFriendCode(`  ${encodeFriendCode(contents)}\n`);
    expect(parsed.ok).toBe(true);
  });

  it("rejects endpoints that are not http", () => {
    // A code naming any other scheme is either a mistake or an attempt to point
    // the redemption somewhere the app should not be dialling.
    for (const httpBaseUrl of ["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)"]) {
      const parsed = parseFriendCode(encodeFriendCode({ ...contents, httpBaseUrl }));
      expect(parsed).toEqual({ ok: false, reason: "bad-endpoint" });
    }
  });

  it("accepts https endpoints", () => {
    const parsed = parseFriendCode(
      encodeFriendCode({ ...contents, httpBaseUrl: "https://alice.example.com" }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("rejects anything that is not a friend code", () => {
    for (const value of ["", "hello", "mlfriend1_not-base64!!", "mlfriend1_"]) {
      expect(parseFriendCode(value).ok).toBe(false);
    }
  });

  it("rejects a code whose payload is not the expected shape", () => {
    const encoded = Buffer.from(JSON.stringify({ v: 1, e: "env" }), "utf8").toString("base64url");
    expect(parseFriendCode(`mlfriend1_${encoded}`)).toEqual({ ok: false, reason: "malformed" });
  });

  it("reports a newer code version as unsupported rather than malformed", () => {
    // The distinction matters for the message shown: "update ML Code" is
    // actionable, "that is not a friend code" is not.
    const encoded = Buffer.from(JSON.stringify({ v: 2 }), "utf8").toString("base64url");
    expect(parseFriendCode(`mlfriend1_${encoded}`)).toEqual({
      ok: false,
      reason: "unsupported-version",
    });
  });

  it("recognizes the shape without validating the contents", () => {
    expect(looksLikeFriendCode("mlfriend1_anything")).toBe(true);
    expect(looksLikeFriendCode("   mlfriend1_x")).toBe(true);
    expect(looksLikeFriendCode("mlfriend2_x")).toBe(false);
  });
});
