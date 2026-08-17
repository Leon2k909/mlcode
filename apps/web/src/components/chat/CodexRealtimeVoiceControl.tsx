import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderRealtimeEvent,
  ThreadId,
} from "@t3tools/contracts";
import { MicIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { realtimeVoiceEnvironment } from "../../state/realtimeVoice";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  codexRealtimeVoiceUnavailableReason,
  isCodexRealtimeVoiceAvailable,
} from "./CodexRealtimeVoice.logic";

interface Props {
  readonly environmentId: EnvironmentId;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId | null;
}

function readEventError(event: ProviderRealtimeEvent): string | null {
  if (event.type !== "thread.realtime.error") return null;
  return event.payload.message;
}

export function CodexRealtimeVoiceControl({ environmentId, provider, threadId }: Props) {
  const available = isCodexRealtimeVoiceAvailable(provider, threadId);
  const unavailableReason = codexRealtimeVoiceUnavailableReason(provider, threadId);
  const events = useEnvironmentQuery(
    available && threadId !== null
      ? realtimeVoiceEnvironment.events({ environmentId, input: { threadId } })
      : null,
  );
  const start = useAtomCommand(realtimeVoiceEnvironment.start, {
    label: "start Codex realtime voice",
    reportFailure: false,
  });
  const stop = useAtomCommand(realtimeVoiceEnvironment.stop, {
    label: "stop Codex realtime voice",
    reportFailure: false,
  });
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const activeRef = useRef(false);
  const sessionStartedRef = useRef(false);
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanupPeer = useCallback(() => {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    for (const track of localStreamRef.current?.getTracks() ?? []) track.stop();
    localStreamRef.current = null;
    if (remoteAudioRef.current !== null) remoteAudioRef.current.srcObject = null;
    sessionStartedRef.current = false;
    activeRef.current = false;
    setActive(false);
  }, []);

  const stopAndCleanup = useCallback(() => {
    if (threadId !== null && sessionStartedRef.current) {
      sessionStartedRef.current = false;
      void stop({ environmentId, input: { threadId } }).finally(cleanupPeer);
      return;
    }
    cleanupPeer();
  }, [cleanupPeer, environmentId, stop, threadId]);

  useEffect(() => {
    const event = events.data;
    if (event === null || event.eventId === lastEventIdRef.current) return;
    lastEventIdRef.current = event.eventId;

    const eventError = readEventError(event);
    if (eventError !== null) {
      setError(eventError);
      stopAndCleanup();
      return;
    }
    if (event.type === "thread.realtime.sdp") {
      void peerConnectionRef.current
        ?.setRemoteDescription({ type: "answer", sdp: event.payload.sdp })
        .catch(() => {
          setError("The realtime voice connection could not be established.");
          stopAndCleanup();
        });
    } else if (event.type === "thread.realtime.closed") {
      cleanupPeer();
    }
  }, [cleanupPeer, events.data, stopAndCleanup]);

  useEffect(
    () => () => {
      stopAndCleanup();
    },
    [stopAndCleanup],
  );

  const handleStart = useCallback(async () => {
    if (!available || threadId === null || pending || active) return;
    if (
      typeof window === "undefined" ||
      typeof RTCPeerConnection === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError("This browser does not provide microphone access for voice.");
      return;
    }

    setPending(true);
    setError(null);
    const peerConnection = new RTCPeerConnection();
    peerConnectionRef.current = peerConnection;
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = localStream;
      for (const track of localStream.getAudioTracks()) peerConnection.addTrack(track, localStream);
      peerConnection.createDataChannel("oai-events");
      peerConnection.ontrack = (event) => {
        const stream = event.streams[0];
        if (stream !== undefined && remoteAudioRef.current !== null) {
          remoteAudioRef.current.srcObject = stream;
        }
      };
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      sessionStartedRef.current = true;
      const result = await start({
        environmentId,
        input: {
          threadId,
          outputModality: "audio",
          version: "v3",
          transport: { type: "webrtc", sdp: offer.sdp ?? "" },
        },
      });
      if (result._tag === "Failure") {
        setError("The Codex realtime voice session could not be started.");
        stopAndCleanup();
        return;
      }
      activeRef.current = true;
      setActive(true);
    } catch {
      setError("Microphone access or realtime voice setup failed.");
      stopAndCleanup();
    } finally {
      setPending(false);
    }
  }, [active, available, pending, start, stopAndCleanup, threadId]);

  const handleStop = useCallback(async () => {
    stopAndCleanup();
  }, [stopAndCleanup]);

  const label = active ? "Stop Codex voice" : (unavailableReason ?? "Start Codex voice");

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        title={error ?? label}
        disabled={!available || pending}
        onClick={() => void (active ? handleStop() : handleStart())}
        data-codex-realtime-voice={available ? "available" : "unsupported"}
      >
        {active ? <SquareIcon /> : <MicIcon />}
      </Button>
      <audio ref={remoteAudioRef} autoPlay className="hidden" />
    </>
  );
}
