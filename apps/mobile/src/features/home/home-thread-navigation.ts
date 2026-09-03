import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  CommonActions,
  StackActions,
  useNavigation,
  type NavigationState,
  type ParamListBase,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef } from "react";

type ThreadSelection = Pick<EnvironmentThreadShell, "environmentId" | "id">;

export function createHomeThreadNavigationAction(input: {
  readonly state: Pick<NavigationState, "index" | "routes">;
  readonly dismissingRouteKey: string | null;
  readonly thread: ThreadSelection;
}) {
  const currentRoute = input.state.routes[input.state.index];
  const params = {
    environmentId: input.thread.environmentId,
    threadId: input.thread.id,
  };

  // Native swipe-back pops the outgoing route after its animation. Reusing
  // that key would also discard this selection when the dismissal arrives.
  if (input.dismissingRouteKey !== null && currentRoute?.key === input.dismissingRouteKey) {
    return StackActions.push("Thread", params);
  }

  return CommonActions.navigate("Thread", params);
}

export function useHomeThreadSelection() {
  // NOTE: typed against ParamListBase (like StackHeader) rather than the global
  // RootParamList. This hook drives navigation through CommonActions/StackActions
  // (not the param-list-typed navigate), and only needs the native-stack event
  // map for transitionStart; the reconstructed RootParamList (see
  // navigation-param-list.d.ts) is a large mapped type tsgo will not accept as a
  // ParamListBase constraint argument.
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const dismissingRouteKey = useRef<string | null>(null);

  useEffect(() => {
    const clear = () => {
      dismissingRouteKey.current = null;
    };
    // This listener belongs to Home, so swipe-back is its opening transition.
    // Thread's closing event is targeted at the outgoing Thread route.
    const removeTransitionStart = navigation.addListener("transitionStart", ({ data }) => {
      const state = navigation.getState();
      const currentRoute = state.routes[state.index];
      dismissingRouteKey.current =
        !data.closing && currentRoute?.name === "Thread" ? currentRoute.key : null;
    });
    const removeFocus = navigation.addListener("focus", clear);

    return () => {
      clear();
      removeTransitionStart();
      removeFocus();
    };
  }, [navigation]);

  return useCallback(
    (thread: ThreadSelection) => {
      navigation.dispatch((state) =>
        createHomeThreadNavigationAction({
          state,
          dismissingRouteKey: dismissingRouteKey.current,
          thread,
        }),
      );
    },
    [navigation],
  );
}
