import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";
import BranchPullRequest from "./Migrations/048_ProjectionThreadBranchPullRequest.ts";
import ActiveOrderKey from "./Migrations/049_ProjectionThreadsActiveOrderKey.ts";
import ThreadPullRequests from "./Migrations/050_ProjectionThreadPullRequests.ts";
import MessageContext from "./Migrations/051_ProjectionThreadMessageContext.ts";
import TitleState from "./Migrations/052_ProjectionThreadTitleState.ts";
import PullRequestFilesViewed from "./Migrations/053_PullRequestFilesViewed.ts";

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

const firstSharedV2Migration = 54;
const missedUpstreamMigrations = [
  BranchPullRequest,
  ActiveOrderKey,
  ThreadPullRequests,
  MessageContext,
  TitleState,
  PullRequestFilesViewed,
];

export const reconcileMlCodeMigrations = Effect.fn("reconcileMlCodeMigrations")(function* (
  manifest: ReadonlyArray<readonly [number, string]>,
) {
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
      const upstream = new Map(manifest);
      const lastForkMigration = firstSharedV2Migration - 1;
      if (
        !history.every(
          (row, index) =>
            row.migration_id === firstForkMigration + index &&
            row.name ===
              (row.migration_id <= lastForkMigration
                ? forkMigrations[index]
                : upstream.get(row.migration_id)),
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
        WHERE migration_id BETWEEN ${firstForkMigration} AND ${lastForkMigration}
      `;
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN ${firstForkMigration} AND ${lastForkMigration}`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name, created_at)
        SELECT migration_id - 6, name, created_at FROM mlcode_legacy_migrations
        WHERE migration_id >= 47
      `;
      if (history.some((row) => row.migration_id === firstSharedV2Migration)) {
        // The V2 preview reused upstream IDs from 54 and never ran these six migrations.
        for (const [index, migration] of missedUpstreamMigrations.entries()) {
          const id = firstSharedV2Migration - missedUpstreamMigrations.length + index;
          yield* migration;
          yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${upstream.get(id)!})`;
        }
      }
    }),
  );
});
