import { createFileRoute } from "@tanstack/react-router";

import { FriendsSettings } from "../components/settings/FriendsSettings";

export const Route = createFileRoute("/settings/friends")({
  component: FriendsSettings,
});
