import type { FriendId, ThreadId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { SharedChatView } from "../components/friends/SharedChatView";

function SharedChatRoute() {
  const { friendId, threadId } = Route.useParams();
  return <SharedChatView friendId={friendId as FriendId} threadId={threadId as ThreadId} />;
}

export const Route = createFileRoute("/_chat/friends/$friendId/$threadId")({
  component: SharedChatRoute,
});
