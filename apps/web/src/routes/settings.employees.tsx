import { createFileRoute } from "@tanstack/react-router";

import { EmployeeSettingsPanel } from "../components/settings/EmployeeSettingsPanel";

export const Route = createFileRoute("/settings/employees")({
  component: EmployeeSettingsPanel,
});
