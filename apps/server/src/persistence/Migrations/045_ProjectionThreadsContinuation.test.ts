import { assert, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import { SqlitePersistenceMemory } from "../Layers/Sqlite.ts";

layer(SqlitePersistenceMemory)("045_ProjectionThreadsContinuation", (it) => {
  it.effect("adds one nullable continuation column and remains idempotent", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 44 });
      yield* runMigrations({ toMigrationInclusive: 45 });
      yield* runMigrations({ toMigrationInclusive: 45 });
      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_threads)
      `;
      const matches = columns.filter((column) => column.name === "continuation_json");
      assert.equal(matches.length, 1);
      assert.equal(matches[0]?.notnull, 0);
    }),
  );
});
