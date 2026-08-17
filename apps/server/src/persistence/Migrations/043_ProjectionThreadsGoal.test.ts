import { assert, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import { SqlitePersistenceMemory } from "../Layers/Sqlite.ts";

layer(SqlitePersistenceMemory)("043_ProjectionThreadsGoal", (it) => {
  it.effect("adds one nullable goal column and remains idempotent", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 42 });
      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* runMigrations({ toMigrationInclusive: 43 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_threads)
      `;
      const goalColumns = columns.filter((column) => column.name === "goal_json");

      assert.equal(goalColumns.length, 1);
      assert.equal(goalColumns[0]?.notnull, 0);
    }),
  );
});
