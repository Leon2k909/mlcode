// Registers the root static navigator's screens as the global navigation param
// list, so `useNavigation().navigate("Route", params)` is typed across the app.
//
// React Navigation's documented static-API registration augments
// `ReactNavigation.RootParamList` with `StaticParamList<typeof RootStack>`. Two
// things make that unusable here: `@react-navigation/core` (which owns the
// `RootNavigator`/`RootParamList` globals) is not directly resolvable from this
// app under pnpm, and tsgo currently resolves the re-exported `StaticParamList`
// as non-generic. So the param list is reconstructed locally from the
// navigator's `config.screens`, matching core's own `StaticParamList` shape.
// Nested navigators are typed loosely (any child screen + params) rather than
// recursed into, which keeps tsgo from collapsing the mapped type to `any`.

import type { NavigatorScreenParams } from "@react-navigation/native";
import type * as React from "react";

import type { RootStack } from "./Stack";

type FlatType<T> = { [K in keyof T]: T[K] } & {};
type KeysOf<T> = T extends {} ? keyof T : never;
type UnknownToUndefined<T> = unknown extends T ? undefined : T;
type ParamsForScreenComponent<T> = T extends {
  screen: React.ComponentType<{ route: { params: infer P } }>;
}
  ? P
  : T extends React.ComponentType<{ route: { params: infer P } }>
    ? P
    : undefined;
type NavigatorLike = {
  readonly config: {
    readonly screens?: Record<string, any>;
  };
};
type NestedParams = NavigatorScreenParams<Record<string, object | undefined>> | undefined;
type ParamsForScreen<T> = T extends { screen: infer Screen }
  ? Screen extends NavigatorLike
    ? NestedParams
    : UnknownToUndefined<ParamsForScreenComponent<T>>
  : UnknownToUndefined<ParamsForScreenComponent<T>>;
type StaticParamListFromScreens<T extends NavigatorLike> = FlatType<{
  [Key in KeysOf<T["config"]["screens"]>]: ParamsForScreen<T["config"]["screens"][Key]>;
}>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends StaticParamListFromScreens<typeof RootStack> {}
  }
}
