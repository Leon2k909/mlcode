import { Connection } from "@t3tools/client-runtime/connection";
import { layerWithSession as friendLinkLayer } from "@t3tools/client-runtime/friends";
import { shellSnapshotLoaderLayer } from "@t3tools/client-runtime/state/shell";
import { threadSnapshotLoaderLayer } from "@t3tools/client-runtime/state/threads";
import { pullRequestDiffLoaderLayer } from "@t3tools/client-runtime/state/pull-requests";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import { runtimeContextLayer } from "../lib/runtime";
import {
  backgroundActivityObserverLayer,
  backgroundActivityReporterLayer,
} from "../lib/backgroundActivityReporter";
import { connectionPlatformLayer } from "./platform";

const providedConnectionPlatformLayer = connectionPlatformLayer.pipe(
  Layer.provide(runtimeContextLayer),
);

const snapshotLoaderLayer = Layer.mergeAll(
  threadSnapshotLoaderLayer,
  shellSnapshotLoaderLayer,
  pullRequestDiffLoaderLayer,
);

type ConnectionLayerSource =
  | typeof Connection.layer
  | typeof friendLinkLayer
  | typeof snapshotLoaderLayer
  | typeof runtimeContextLayer
  | typeof connectionPlatformLayer
  | typeof backgroundActivityObserverLayer
  | typeof backgroundActivityReporterLayer;

// Guest links sit beside the connection layer, not inside it: a friend's server
// is somebody else's environment and must never be registered as one of ours.
const providedClientConnectionLayer = Layer.mergeAll(
  Connection.layer,
  snapshotLoaderLayer,
  friendLinkLayer,
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      runtimeContextLayer,
      providedConnectionPlatformLayer,
      backgroundActivityObserverLayer,
    ),
  ),
);

const connectionLayer = backgroundActivityReporterLayer.pipe(
  Layer.provideMerge(providedClientConnectionLayer),
);

export const connectionAtomRuntime: Atom.AtomRuntime<
  Layer.Success<ConnectionLayerSource>,
  Layer.Error<ConnectionLayerSource>
> = Atom.runtime(connectionLayer);
