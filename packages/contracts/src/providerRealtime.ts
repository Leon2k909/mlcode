import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import { ProviderRuntimeEvent } from "./providerRuntime.ts";

/** Experimental transport choices exposed by Codex thread/realtime. */
export const ProviderRealtimeTransport = Schema.Union([
  Schema.Struct({ type: Schema.Literal("websocket") }),
  Schema.Struct({ type: Schema.Literal("webrtc"), sdp: Schema.String }),
]);
export type ProviderRealtimeTransport = typeof ProviderRealtimeTransport.Type;

export const ProviderRealtimeOutputModality = Schema.Literals(["text", "audio"]);
export type ProviderRealtimeOutputModality = typeof ProviderRealtimeOutputModality.Type;

export const ProviderRealtimeConversationVersion = Schema.Literals(["v1", "v2", "v3"]);
export type ProviderRealtimeConversationVersion = typeof ProviderRealtimeConversationVersion.Type;

export const ProviderRealtimeTextRole = Schema.Literals(["user", "assistant", "system"]);
export type ProviderRealtimeTextRole = typeof ProviderRealtimeTextRole.Type;

export const ProviderRealtimeInitialItem = Schema.Struct({
  role: ProviderRealtimeTextRole,
  text: Schema.String,
});
export type ProviderRealtimeInitialItem = typeof ProviderRealtimeInitialItem.Type;

export const ProviderRealtimeStartInput = Schema.Struct({
  threadId: ThreadId,
  providerInstanceId: Schema.optional(ProviderInstanceId),
  outputModality: ProviderRealtimeOutputModality,
  transport: Schema.optional(ProviderRealtimeTransport),
  version: Schema.optional(ProviderRealtimeConversationVersion),
  model: Schema.optional(Schema.String),
  voice: Schema.optional(Schema.String),
  includeStartupContext: Schema.optional(Schema.Boolean),
  initialItems: Schema.optional(Schema.Array(ProviderRealtimeInitialItem)),
  realtimeStartInstructions: Schema.optional(Schema.String),
});
export type ProviderRealtimeStartInput = typeof ProviderRealtimeStartInput.Type;

export const ProviderRealtimeStartResult = Schema.Struct({
  threadId: ThreadId,
  provider: ProviderDriverKind,
  outputModality: ProviderRealtimeOutputModality,
  transport: ProviderRealtimeTransport,
  realtimeSessionId: Schema.optional(Schema.String),
});
export type ProviderRealtimeStartResult = typeof ProviderRealtimeStartResult.Type;

export const ProviderRealtimeAudioChunk = Schema.Struct({
  data: Schema.String,
  sampleRate: Schema.Number,
  numChannels: Schema.Number,
  samplesPerChannel: Schema.optional(Schema.Number),
  itemId: Schema.optional(Schema.String),
});
export type ProviderRealtimeAudioChunk = typeof ProviderRealtimeAudioChunk.Type;

export const ProviderRealtimeAppendAudioInput = Schema.Struct({
  threadId: ThreadId,
  audio: ProviderRealtimeAudioChunk,
});
export type ProviderRealtimeAppendAudioInput = typeof ProviderRealtimeAppendAudioInput.Type;

export const ProviderRealtimeAppendTextInput = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String,
  role: Schema.optional(ProviderRealtimeTextRole),
});
export type ProviderRealtimeAppendTextInput = typeof ProviderRealtimeAppendTextInput.Type;

export const ProviderRealtimeAppendSpeechInput = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String,
});
export type ProviderRealtimeAppendSpeechInput = typeof ProviderRealtimeAppendSpeechInput.Type;

export const ProviderRealtimeStopInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderRealtimeStopInput = typeof ProviderRealtimeStopInput.Type;

export const ProviderRealtimeEmptyResult = Schema.Struct({});
export type ProviderRealtimeEmptyResult = typeof ProviderRealtimeEmptyResult.Type;

export const ProviderRealtimeSubscriptionInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderRealtimeSubscriptionInput = typeof ProviderRealtimeSubscriptionInput.Type;

export class ProviderRealtimeRpcError extends Schema.TaggedErrorClass<ProviderRealtimeRpcError>()(
  "ProviderRealtimeRpcError",
  {
    code: Schema.String,
    message: Schema.String,
  },
) {}

/** The event stream is filtered server-side to realtime events for one thread. */
export const ProviderRealtimeEvent = ProviderRuntimeEvent;
export type ProviderRealtimeEvent = typeof ProviderRealtimeEvent.Type;
