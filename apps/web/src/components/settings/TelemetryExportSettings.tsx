import { T, useGT } from "gt-react";
import { SettingsSection } from "./settingsLayout";

export function TelemetryExportSettings() {
  const gt = useGT();
  return (
    <SettingsSection title={gt("OpenTelemetry export")} id="telemetry-export">
      <p className="text-sm text-muted-foreground">
        <T>ML Code keeps diagnostics on this machine. Export is disabled.</T>
      </p>
    </SettingsSection>
  );
}
