import { createFileRoute } from "@tanstack/react-router";

import { SharedChatsIndex } from "../components/friends/SharedChatsIndex";

export const Route = createFileRoute("/_chat/friends/")({
  component: SharedChatsIndex,
});
