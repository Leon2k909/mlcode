import type {
  EnvironmentId,
  MessageId,
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  UploadChatAttachment,
} from "@t3tools/contracts";
import { create } from "zustand";

import type { QueuedComposerMessage } from "./components/chat/ChatComposer";

export interface QueuedThreadOutboxPayload {
  readonly messageId: MessageId;
  readonly threadId: ThreadId;
  readonly text: string;
  readonly createdAt: string;
  readonly titleSeed: string;
  // This outbox intentionally lives only for the current app session. The
  // attachment preparation promise and blob preview URLs are not serializable.
  readonly attachmentsPromise: Promise<ReadonlyArray<UploadChatAttachment>>;
  readonly optimisticAttachments: ReadonlyArray<QueuedThreadOutboxAttachment>;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

export interface QueuedThreadOutboxAttachment {
  readonly type: "image";
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly previewUrl: string;
}

export interface QueuedThreadOutboxMessage extends QueuedComposerMessage {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly payload: QueuedThreadOutboxPayload;
}

type MessageUpdater = (
  existing: ReadonlyArray<QueuedThreadOutboxMessage>,
) => ReadonlyArray<QueuedThreadOutboxMessage>;

interface ThreadOutboxStore {
  readonly messages: ReadonlyArray<QueuedThreadOutboxMessage>;
  readonly setMessages: (updater: MessageUpdater) => void;
}

/**
 * Session-scoped web outbox. Keeping it above route components prevents a
 * thread navigation from dropping a queued follow-up before it reaches the
 * server. It deliberately is not persisted until attachments have a durable
 * representation.
 */
export const useThreadOutboxStore = create<ThreadOutboxStore>()((set) => ({
  messages: [],
  setMessages: (updater) => set((state) => ({ messages: updater(state.messages) })),
}));
