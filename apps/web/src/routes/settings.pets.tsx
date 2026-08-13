import { createFileRoute } from "@tanstack/react-router";

import { PetSettingsPanel } from "../components/settings/PetSettingsPanel";

export const Route = createFileRoute("/settings/pets")({
  component: PetSettingsPanel,
});
