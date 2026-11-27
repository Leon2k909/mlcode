import type { OtlpEndpointCheckInput, OtlpEndpointCheckResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class OtlpEndpointCheck extends Context.Service<
  OtlpEndpointCheck,
  {
    readonly check: (input: OtlpEndpointCheckInput) => Effect.Effect<OtlpEndpointCheckResult>;
  }
>()("t3/observability/OtlpEndpointCheck") {}

export const layer = Layer.succeed(OtlpEndpointCheck, {
  check: () => Effect.succeed({ _tag: "Unreachable", timedOut: false }),
});
