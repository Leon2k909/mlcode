import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

export const realtimeVoiceEnvironment = {
  events: createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "environment-data:provider-realtime:events",
    tag: WS_METHODS.subscribeProviderRealtime,
    idleTtlMs: 0,
  }),
  start: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "provider-realtime:start",
    tag: WS_METHODS.providerRealtimeStart,
  }),
  appendAudio: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "provider-realtime:append-audio",
    tag: WS_METHODS.providerRealtimeAppendAudio,
  }),
  appendText: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "provider-realtime:append-text",
    tag: WS_METHODS.providerRealtimeAppendText,
  }),
  appendSpeech: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "provider-realtime:append-speech",
    tag: WS_METHODS.providerRealtimeAppendSpeech,
  }),
  stop: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "provider-realtime:stop",
    tag: WS_METHODS.providerRealtimeStop,
  }),
};
