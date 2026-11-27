import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AnalyticsService, layer } from "./AnalyticsService.ts";

it.effect("does not queue or export usage and feedback events", () =>
  Effect.gen(function* () {
    const analytics = yield* AnalyticsService;
    assert.isFalse(yield* analytics.record("provider.request.completed", { model: "example" }));
    assert.isFalse(yield* analytics.record("agent.feedback", {}, { anonymous: true }));
    yield* analytics.recordOwners([], "client");
    yield* analytics.flush;
  }).pipe(Effect.provide(layer)),
);
