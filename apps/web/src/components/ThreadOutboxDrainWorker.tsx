import { useEffect, useMemo, useRef } from "react";

import {
  mapAtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";

import { resolveThreadMetadataUpdateForNextTurn } from "./ChatView.logic";
import { useThreadOutboxStore, type QueuedThreadOutboxMessage } from "../threadOutbox";
import { useThreadShells } from "../state/entities";
import { useEnvironments } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import { threadEnvironment } from "../state/threads";
import { toastManager } from "./ui/toast";

function isReadyForQueuedTurn(
  message: QueuedThreadOutboxMessage,
  input: {
    readonly connectedEnvironmentIds: ReadonlySet<string>;
    readonly threadsByKey: ReadonlyMap<string, ReturnType<typeof useThreadShells>[number]>;
  },
): boolean {
  if (!input.connectedEnvironmentIds.has(message.environmentId)) return false;
  const thread = input.threadsByKey.get(scopedThreadKey(message));
  return thread?.session?.status === "idle" || thread?.session?.status === "ready";
}

/**
 * Runs above route and chat-pane components so a queued follow-up belongs to
 * its thread rather than the particular ChatView that happened to enqueue it.
 */
export function ThreadOutboxDrainWorker() {
  const messages = useThreadOutboxStore((state) => state.messages);
  const setMessages = useThreadOutboxStore((state) => state.setMessages);
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const setThreadRuntimeMode = useAtomCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const setThreadInteractionMode = useAtomCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });
  const startThreadTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const dispatchingMessageIdRef = useRef<string | null>(null);
  const threadsByKey = useMemo(
    () =>
      new Map(
        threads.map((thread) => [
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          thread,
        ]),
      ),
    [threads],
  );
  const connectedEnvironmentIds = useMemo(
    () =>
      new Set(
        environments
          .filter((environment) => environment.connection.phase === "connected")
          .map((environment) => environment.environmentId),
      ),
    [environments],
  );

  useEffect(() => {
    if (dispatchingMessageIdRef.current !== null) return;
    const next = messages.find(
      (message) =>
        message.status === "queued" &&
        isReadyForQueuedTurn(message, { connectedEnvironmentIds, threadsByKey }),
    );
    if (!next) return;

    dispatchingMessageIdRef.current = next.id;
    setMessages((existing) =>
      existing.map((message) =>
        message.id === next.id &&
        message.threadId === next.threadId &&
        message.environmentId === next.environmentId
          ? { ...message, status: "sending" as const }
          : message,
      ),
    );

    void (async () => {
      let delivered = false;
      try {
        const thread = threadsByKey.get(scopedThreadKey(next));
        if (!thread) return;
        const attachmentsResult = await settlePromise(() => next.payload.attachmentsPromise);
        if (attachmentsResult._tag === "Failure") {
          toastManager.add({
            type: "error",
            title: "Couldn't attach images to queued message",
            description: "The message will be marked as failed so you can retry it.",
          });
          throw squashAtomCommandFailure(attachmentsResult);
        }
        const attachments = attachmentsResult.value;
        const metadataUpdate = resolveThreadMetadataUpdateForNextTurn({
          currentModelSelection: thread.modelSelection,
          nextModelSelection: next.payload.modelSelection,
          currentBranch: thread.branch,
        });
        if (metadataUpdate) {
          const result = mapAtomCommandResult(
            await updateThreadMetadata({
              environmentId: next.environmentId,
              input: { threadId: next.threadId, ...metadataUpdate },
            }),
            () => undefined,
          );
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        }
        if (next.payload.runtimeMode !== thread.runtimeMode) {
          const result = mapAtomCommandResult(
            await setThreadRuntimeMode({
              environmentId: next.environmentId,
              input: {
                threadId: next.threadId,
                runtimeMode: next.payload.runtimeMode,
                createdAt: next.payload.createdAt,
              },
            }),
            () => undefined,
          );
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        }
        if (next.payload.interactionMode !== thread.interactionMode) {
          const result = mapAtomCommandResult(
            await setThreadInteractionMode({
              environmentId: next.environmentId,
              input: {
                threadId: next.threadId,
                interactionMode: next.payload.interactionMode,
                createdAt: next.payload.createdAt,
              },
            }),
            () => undefined,
          );
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        }
        const result = await startThreadTurn({
          environmentId: next.environmentId,
          input: {
            threadId: next.threadId,
            message: {
              messageId: next.payload.messageId,
              role: "user",
              text: next.payload.text,
              attachments,
            },
            modelSelection: next.payload.modelSelection,
            titleSeed: next.payload.titleSeed,
            runtimeMode: next.payload.runtimeMode,
            interactionMode: next.payload.interactionMode,
            createdAt: next.payload.createdAt,
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        delivered = true;
      } catch (error) {
        console.warn("[thread-outbox] queued message delivery failed", error);
      } finally {
        setMessages((existing) =>
          delivered
            ? existing.filter(
                (message) =>
                  message.id !== next.id ||
                  message.threadId !== next.threadId ||
                  message.environmentId !== next.environmentId,
              )
            : existing.map((message) =>
                message.id === next.id &&
                message.threadId === next.threadId &&
                message.environmentId === next.environmentId
                  ? { ...message, status: "failed" as const }
                  : message,
              ),
        );
        dispatchingMessageIdRef.current = null;
      }
    })();
  }, [
    connectedEnvironmentIds,
    messages,
    setMessages,
    setThreadInteractionMode,
    setThreadRuntimeMode,
    startThreadTurn,
    threadsByKey,
    updateThreadMetadata,
  ]);

  return null;
}
