import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  ProviderRealtimeAppendAudioInput,
  ProviderRealtimeStartInput,
  ProviderRealtimeTransport,
} from "./providerRealtime.ts";
import { ThreadId } from "./baseSchemas.ts";

const decodeStartInput = Schema.decodeUnknownSync(ProviderRealtimeStartInput);
const decodeAudioInput = Schema.decodeUnknownSync(ProviderRealtimeAppendAudioInput);
const decodeTransport = Schema.decodeUnknownSync(ProviderRealtimeTransport);

describe("Provider realtime contracts", () => {
  it("accepts Codex WebRTC start parameters", () => {
    const input = decodeStartInput({
      threadId: ThreadId.make("thread-voice"),
      outputModality: "audio",
      transport: { type: "webrtc", sdp: "v=0\\r\\n" },
      version: "v2",
      voice: "alloy",
      includeStartupContext: true,
      initialItems: [{ role: "user", text: "Hello" }],
    });

    expect(input.threadId).toBe("thread-voice");
    expect(input.transport).toEqual({ type: "webrtc", sdp: "v=0\\r\\n" });
    expect(input.initialItems).toEqual([{ role: "user", text: "Hello" }]);
  });

  it("accepts raw audio chunks for the appendAudio RPC", () => {
    const input = decodeAudioInput({
      threadId: ThreadId.make("thread-voice"),
      audio: {
        data: "AAECAw==",
        sampleRate: 24_000,
        numChannels: 1,
        samplesPerChannel: 4,
      },
    });

    expect(input.audio.sampleRate).toBe(24_000);
    expect(input.audio.numChannels).toBe(1);
  });

  it("keeps transport choices explicitly Codex realtime-only", () => {
    expect(decodeTransport({ type: "websocket" })).toEqual({ type: "websocket" });
    expect(() => decodeTransport({ type: "webrtc", sdp: 42 })).toThrow();
  });
});
