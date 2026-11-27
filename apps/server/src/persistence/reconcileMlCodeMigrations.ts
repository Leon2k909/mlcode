import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

const firstForkMigration = 41;
const forkMigrations = [
  "ProjectionThreadMessageEmployeeId",
  "ProjectionProjectRepositoryIdentity",
  "ProjectionThreadsGoal",
  "ProjectionThreadMessageModelSelection",
  "ProjectionThreadsContinuation",
  "Friends",
  "AuthSessionClientConnection",
  "ProjectionThreadLinkedPullRequest",
  "ProjectionThreadsUnsettledAt",
  "ClearAutomaticProjectModelDefaults",
  "ProjectionProjectsAutoPull",
  "RepairAutomaticSettlementTimestamps",
  "ProjectionProjectIcon",
] as const;

export const reconcileMlCodeMigrations = Effect.fn("reconcileMlCodeMigrations")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations
        WHERE migration_id >= ${firstForkMigration}
        ORDER BY migration_id
      `;
      if (history[0]?.name !== forkMigrations[0]) return;
      if (
        !history.every(
          (row, index) =>
            row.migration_id === firstForkMigration + index && row.name === forkMigrations[index],
        )
      ) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: "Cannot upgrade this ML Code database because its migration history is unknown.",
        });
      }

      // ML Code added six migrations before upstream's migration 41.
      // Archive the original ledger entries and leave their schema and data in place.
      yield* sql`
        CREATE TABLE mlcode_legacy_migrations AS
        SELECT migration_id, name, created_at FROM effect_sql_migrations
        WHERE migration_id >= ${firstForkMigration}
      `;
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= ${firstForkMigration}`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name, created_at)
        SELECT migration_id - 6, name, created_at FROM mlcode_legacy_migrations
        WHERE migration_id >= 47
      `;
    }),
  );
});
