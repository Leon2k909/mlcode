import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import EmployeeId from "./Migrations/041_ProjectionThreadMessageEmployeeId.ts";
import RepositoryIdentity from "./Migrations/042_ProjectionProjectRepositoryIdentity.ts";
import ThreadGoal from "./Migrations/043_ProjectionThreadsGoal.ts";
import MessageModelSelection from "./Migrations/044_ProjectionThreadMessageModelSelection.ts";
import ThreadContinuation from "./Migrations/045_ProjectionThreadsContinuation.ts";
import Friends from "./Migrations/046_Friends.ts";

it.effect("upgrades the published ML Code migration history through upstream", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 47 });
    yield* sql`UPDATE effect_sql_migrations SET migration_id = -migration_id WHERE migration_id >= 41`;
    yield* sql`UPDATE effect_sql_migrations SET migration_id = 6 - migration_id WHERE migration_id < 0`;

    const forkLoader = Migrator.fromRecord({
      "41_ProjectionThreadMessageEmployeeId": EmployeeId,
      "42_ProjectionProjectRepositoryIdentity": RepositoryIdentity,
      "43_ProjectionThreadsGoal": ThreadGoal,
      "44_ProjectionThreadMessageModelSelection": MessageModelSelection,
      "45_ProjectionThreadsContinuation": ThreadContinuation,
      "46_Friends": Friends,
    });
    for (const [id, name, load] of yield* forkLoader) {
      yield* yield* load;
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
    }

    yield* runMigrations();
    const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
      SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
    `;
    assert.deepStrictEqual(
      rows.map(({ migration_id, name }) => [migration_id, name]),
      migrationManifest,
    );
    const [archive] = yield* sql<{
      readonly count: number;
    }>`SELECT COUNT(*) AS count FROM mlcode_legacy_migrations`;
    assert.strictEqual(archive?.count, 13);
    assert.deepStrictEqual(yield* runMigrations(), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
