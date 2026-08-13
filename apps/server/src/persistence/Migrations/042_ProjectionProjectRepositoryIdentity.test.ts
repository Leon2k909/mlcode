import { assert, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import { SqlitePersistenceMemory } from "../Layers/Sqlite.ts";

layer(SqlitePersistenceMemory)("042_ProjectionProjectRepositoryIdentity", (it) => {
  it.effect("adds nullable durable repository identity storage to project projections", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });
      yield* runMigrations({ toMigrationInclusive: 42 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_projects)
      `;
      const repositoryIdentity = columns.find(
        (column) => column.name === "repository_identity_json",
      );

      assert.equal(repositoryIdentity?.name, "repository_identity_json");
      assert.equal(repositoryIdentity?.notnull, 0);
    }),
  );
});
