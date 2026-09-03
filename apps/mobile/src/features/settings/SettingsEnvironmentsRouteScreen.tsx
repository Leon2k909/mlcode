import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import { useNavigation } from "@react-navigation/native";
import { SymbolView } from "../../components/AppSymbol";
import { useAtomValue } from "@effect/atom-react";
import type { ContextManagementMode, EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { CloudEnvironmentRows } from "../connection/CloudEnvironmentRows";
import { ConnectionEnvironmentRow } from "../connection/ConnectionEnvironmentRow";
import { splitEnvironmentSections } from "../connection/environmentSections";
import { cn } from "../../lib/cn";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import {
  applyShowcaseLocalEnvironmentDisplayUrls,
  resolveShowcaseEnvironmentUpdateDisplayUrl,
  SHOWCASE_AVAILABLE_CLOUD_ENVIRONMENTS,
  SHOWCASE_CONNECTED_CLOUD_ENVIRONMENTS,
} from "../showcase/showcaseEnvironmentRows";
import { markNativeShowcaseReady } from "../showcase/nativeShowcaseScene";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

const SHOWCASE_ENABLED = process.env.EXPO_PUBLIC_SHOWCASE === "1";

export function SettingsEnvironmentsRouteScreen() {
  const {
    connectedEnvironments,
    onReconnectEnvironment,
    onRemoveEnvironmentPress,
    onUpdateEnvironment,
  } = useRemoteConnections();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const environmentSections = splitEnvironmentSections({
    connectedEnvironments,
    cloudEnvironments: null,
  });
  const localEnvironments = SHOWCASE_ENABLED
    ? applyShowcaseLocalEnvironmentDisplayUrls(environmentSections.localEnvironments)
    : environmentSections.localEnvironments;
  const connectedCloudEnvironments = SHOWCASE_ENABLED
    ? SHOWCASE_CONNECTED_CLOUD_ENVIRONMENTS
    : environmentSections.connectedCloudEnvironments;
  const hasLocalEnvironments = localEnvironments.length > 0;
  const [expandedId, setExpandedId] = useState<EnvironmentId | null>(null);
  const headerIconColor = useUniwindTheme()["--color-icon"];

  const handleToggle = useCallback((environmentId: EnvironmentId) => {
    setExpandedId((prev) => (prev === environmentId ? null : environmentId));
  }, []);
  const handleUpdateEnvironment = useCallback(
    (
      environmentId: EnvironmentId,
      updates: { readonly label: string; readonly displayUrl: string },
    ) => {
      if (!SHOWCASE_ENABLED) return onUpdateEnvironment(environmentId, updates);
      const actualEnvironment = environmentSections.localEnvironments.find(
        (environment) => environment.environmentId === environmentId,
      );
      const presentedEnvironment = localEnvironments.find(
        (environment) => environment.environmentId === environmentId,
      );
      return onUpdateEnvironment(environmentId, {
        ...updates,
        displayUrl:
          actualEnvironment && presentedEnvironment
            ? resolveShowcaseEnvironmentUpdateDisplayUrl({
                actualDisplayUrl: actualEnvironment.displayUrl,
                presentedDisplayUrl: presentedEnvironment.displayUrl,
                submittedDisplayUrl: updates.displayUrl,
              })
            : updates.displayUrl,
      });
    },
    [environmentSections.localEnvironments, localEnvironments, onUpdateEnvironment],
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          {/* Android renders its own in-screen header instead of the native bar. */}
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader
            title="Environments"
            onBack={() => navigation.goBack()}
            actions={[
              {
                accessibilityLabel: "Add environment",
                icon: "plus",
                onPress: () =>
                  navigation.navigate("SettingsSheet", {
                    screen: "SettingsContent",
                    params: { screen: "SettingsEnvironmentNew" },
                  }),
              },
            ]}
          />
        </>
      ) : (
        <NativeHeaderToolbar placement="right">
          <NativeHeaderToolbar.Button
            icon="plus"
            onPress={() =>
              navigation.navigate("SettingsSheet", {
                screen: "SettingsContent",
                params: { screen: "SettingsEnvironmentNew" },
              })
            }
            separateBackground
            tintColor={headerIconColor}
          />
        </NativeHeaderToolbar>
      )}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="px-5 pt-4"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 18,
        }}
      >
        {hasLocalEnvironments ? (
          <View collapsable={false} className="overflow-hidden rounded-[24px] bg-card">
            {localEnvironments.map((environment, index) => (
              <View
                key={environment.environmentId}
                collapsable={false}
                className={cn(index !== 0 && "border-t border-border")}
              >
                <ConnectionEnvironmentRow
                  environment={environment}
                  expanded={expandedId === environment.environmentId}
                  onToggle={() => handleToggle(environment.environmentId)}
                  onReconnect={onReconnectEnvironment}
                  onRemove={onRemoveEnvironmentPress}
                  onUpdate={handleUpdateEnvironment}
                  onSetupProvider={(params) =>
                    navigation.navigate("SettingsSheet", {
                      screen: "SettingsContent",
                      params: { screen: "SettingsProviderSetup", params },
                    })
                  }
                />
                {expandedId === environment.environmentId ? (
                  <ContextManagementEnvironmentControl environmentId={environment.environmentId} />
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <View collapsable={false} className="items-center gap-3 rounded-[24px] bg-card px-6 py-8">
            <View className="h-12 w-12 items-center justify-center rounded-[16px] bg-subtle">
              <SymbolView
                name="point.3.connected.trianglepath.dotted"
                size={20}
                tintColorClassName={"accent-icon-muted"}
                type="monochrome"
              />
            </View>
            <Text className="text-center text-sm leading-normal text-foreground-muted">
              No environments connected yet.{"\n"}Tap{" "}
              <Text className="font-t3-bold text-foreground">+</Text> to add one.
            </Text>
          </View>
        )}

        {/* Always mounted: already-connected relay environments must stay
            visible (and removable) even when cloud config is missing or the
            user is signed out — the component gates discovery itself. */}
        <CloudEnvironmentRows
          connectedCloudEnvironments={connectedCloudEnvironments}
          onReconnectEnvironment={onReconnectEnvironment}
          onSetupProvider={(params) =>
            navigation.navigate("SettingsSheet", {
              screen: "SettingsContent",
              params: { screen: "SettingsProviderSetup", params },
            })
          }
          {...(SHOWCASE_ENABLED
            ? {
                showcaseAvailableEnvironments: SHOWCASE_AVAILABLE_CLOUD_ENVIRONMENTS,
                showcaseSignedIn: true,
              }
            : {})}
        />
      </ScrollView>
    </View>
  );
}

const CONTEXT_MANAGEMENT_OPTIONS = [
  { mode: "manual", label: "Ask me" },
  { mode: "auto-prune", label: "Auto-delete" },
  { mode: "auto-new-thread", label: "New chat" },
] as const satisfies ReadonlyArray<{
  readonly mode: ContextManagementMode;
  readonly label: string;
}>;

function ContextManagementEnvironmentControl(props: { readonly environmentId: EnvironmentId }) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "context management settings update",
    reportFailure: false,
  });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const mode = settings?.contextManagementMode ?? "manual";

  const updateMode = useCallback(
    async (nextMode: ContextManagementMode) => {
      setSaving(true);
      setFailed(false);
      const result = await updateSettings({
        environmentId: props.environmentId,
        input: { patch: { contextManagementMode: nextMode } },
      });
      setSaving(false);
      setFailed(result._tag === "Failure");
    },
    [props.environmentId, updateSettings],
  );

  return (
    <View className="gap-2 border-t border-border px-4 pb-4 pt-3">
      <View className="gap-0.5">
        <Text className="font-t3-medium text-base text-foreground">Long threads</Text>
        <Text className="text-sm leading-normal text-foreground-muted">
          Automatic modes wait for current work to finish and act at 75% context usage.
        </Text>
      </View>
      <View className="flex-row gap-2">
        {CONTEXT_MANAGEMENT_OPTIONS.map((option) => {
          const selected = mode === option.mode;
          return (
            <Pressable
              key={option.mode}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving, selected }}
              disabled={saving}
              onPress={() => void updateMode(option.mode)}
              className={cn(
                "flex-1 items-center rounded-xl border px-2 py-2.5",
                selected ? "border-accent bg-subtle" : "border-border bg-card",
                saving && "opacity-50",
              )}
            >
              <Text
                className={cn("text-sm", selected ? "text-foreground" : "text-foreground-muted")}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {failed ? (
        <Text className="text-sm text-destructive">Could not save. Reconnect and try again.</Text>
      ) : null}
    </View>
  );
}
