/**
 * Friend codes — the pasteable string that links two environments.
 *
 * A code is `mlfriend1_` plus base64url JSON. It is a bearer credential: whoever
 * holds it can redeem it once, so treat it like a pairing URL and hand it over
 * the same way you would a password. Encoding is shared between the server that
 * mints codes and the clients that display and validate them, so that a
 * malformed paste fails in the composer instead of on the wire.
 */
import { FRIEND_CODE_PREFIX, FriendCodePayload, type FriendAvatarColor } from "@t3tools/contracts";
import * as Encoding from "effect/Encoding";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

const decodeFriendCodePayload = Schema.decodeUnknownResult(FriendCodePayload);

export interface FriendCodeContents {
  readonly environmentId: string;
  readonly displayName: string;
  readonly avatarColor: FriendAvatarColor;
  readonly httpBaseUrl: string;
  readonly token: string;
}

export type FriendCodeParseFailure = "malformed" | "unsupported-version" | "bad-endpoint";

export type FriendCodeParseResult =
  | { readonly ok: true; readonly contents: FriendCodeContents }
  | { readonly ok: false; readonly reason: FriendCodeParseFailure };

/**
 * Only http(s) endpoints are accepted. A friend code naming any other scheme is
 * either a mistake or an attempt to point a redemption somewhere unexpected.
 */
function isUsableEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function encodeFriendCode(contents: FriendCodeContents): string {
  const payload = {
    v: 1 as const,
    e: contents.environmentId,
    n: contents.displayName,
    c: contents.avatarColor,
    u: contents.httpBaseUrl,
    t: contents.token,
  };
  return `${FRIEND_CODE_PREFIX}${Encoding.encodeBase64Url(JSON.stringify(payload))}`;
}

export function parseFriendCode(value: string): FriendCodeParseResult {
  const trimmed = value.trim();
  if (!trimmed.startsWith(FRIEND_CODE_PREFIX)) {
    return { ok: false, reason: "malformed" };
  }
  const encoded = trimmed.slice(FRIEND_CODE_PREFIX.length);
  const decoded = Encoding.decodeBase64UrlString(encoded);
  if (Result.isFailure(decoded)) {
    return { ok: false, reason: "malformed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.success);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof parsed === "object" && parsed !== null && "v" in parsed && parsed.v !== 1) {
    return { ok: false, reason: "unsupported-version" };
  }
  const payload = decodeFriendCodePayload(parsed);
  if (Result.isFailure(payload)) {
    return { ok: false, reason: "malformed" };
  }
  if (!isUsableEndpoint(payload.success.u)) {
    return { ok: false, reason: "bad-endpoint" };
  }
  return {
    ok: true,
    contents: {
      environmentId: payload.success.e,
      displayName: payload.success.n,
      avatarColor: payload.success.c,
      httpBaseUrl: payload.success.u,
      token: payload.success.t,
    },
  };
}

/** True when the string is shaped like a friend code, without validating it. */
export function looksLikeFriendCode(value: string): boolean {
  return value.trim().startsWith(FRIEND_CODE_PREFIX);
}
