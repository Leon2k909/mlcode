import {
  AuthFriendParticipateScope,
  AuthFriendScopes,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  FRIEND_GUEST_WS_METHODS,
  WS_METHODS,
  WsRpcGroup,
  isFriendScopeSet,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "./RpcAuthorization.ts";

describe("RPC authorization scopes", () => {
  it("declares exactly one scope for every RPC in the server group", () => {
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
  });

  it("authorizes background policy reporting and observation deliberately", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.serverReportClientActivity)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.serverReportHostPowerState)).toBe(
      AuthOrchestrationOperateScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.serverGetBackgroundPolicy)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.subscribeBackgroundPolicy)).toBe(
      AuthOrchestrationReadScope,
    );
  });

  it("allows relay status reads without granting relay installation access", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.cloudGetRelayClientStatus)).toBe(
      AuthRelayReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.cloudInstallRelayClient)).toBe(AuthRelayWriteScope);
  });

  it("reads the reviewer menu under the same scope as the pull request it belongs to", () => {
    // The candidate list is a read like the detail beside it, and asking somebody for a review is
    // a write like every other pull request operation.
    expect(requiredScopeForRpcMethod(WS_METHODS.pullRequestsReviewerCandidates)).toBe(
      requiredScopeForRpcMethod(WS_METHODS.pullRequestsDetail),
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.pullRequestsRequestReviewers)).toBe(
      requiredScopeForRpcMethod(WS_METHODS.pullRequestsComment),
    );
  });

  it("unlocks the guest surface and nothing else for a friend session", () => {
    // This is the whole containment story for friends: a linked friend holds
    // exactly `friend:participate`, so any method mapped to a different scope is
    // unreachable for them. If a future RPC is mapped to the friend scope by
    // mistake, this fails rather than quietly widening what a coworker can see.
    const friendReachable = Object.entries(RPC_REQUIRED_SCOPES)
      .filter(([, scope]) => scope === AuthFriendParticipateScope)
      .map(([method]) => method);
    expect(new Set(friendReachable)).toEqual(new Set(FRIEND_GUEST_WS_METHODS));
  });

  it("keeps the friend grant disjoint from ordinary client access", () => {
    expect(isFriendScopeSet(AuthFriendScopes)).toBe(true);
    // Reading a thread, opening a terminal, and browsing files must each need a
    // scope a friend does not have.
    for (const method of [
      WS_METHODS.filesystemBrowse,
      WS_METHODS.terminalOpen,
      WS_METHODS.projectsReadFile,
      WS_METHODS.serverGetSettings,
    ]) {
      expect(requiredScopeForRpcMethod(method)).not.toBe(AuthFriendParticipateScope);
    }
  });

  it("treats friend management as ordinary owner operation", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.friendsSubscribe)).toBe(AuthOrchestrationReadScope);
    // Handing back a bearer token for another environment is a write, not a read.
    expect(requiredScopeForRpcMethod(WS_METHODS.friendsGetLinkCredential)).toBe(
      AuthOrchestrationOperateScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.friendsShareThread)).toBe(
      AuthOrchestrationOperateScope,
    );
  });

  it("rejects unknown RPC method names", () => {
    for (const method of ["server.notRegistered", "toString", "constructor"]) {
      expect(() => requiredScopeForRpcMethod(method)).toThrow(
        `RPC method ${method} has no declared authorization scope.`,
      );
    }
  });
});
