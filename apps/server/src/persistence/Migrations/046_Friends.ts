import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Peer-to-peer friends: linked environments, the threads shared with them, and
 * the local identity we present.
 *
 * `friends.invite_subject` is the inbound half of a link — the session subject
 * that friend authenticates with when they reach us — and `access_token` is the
 * outbound half, the credential we hold to reach them. Both halves are unique
 * per friend so a revocation is a single row delete.
 *
 * `announce_code` is the reciprocal friend code we minted for them and still
 * need delivered. Our client carries it over on its next guest session so the
 * server never has to open one of its own.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS friends (
      friend_id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_color TEXT NOT NULL,
      http_base_url TEXT,
      access_token TEXT,
      link_status TEXT NOT NULL,
      invite_subject TEXT NOT NULL,
      announce_code TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS friends_environment_id
    ON friends (environment_id)
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS friends_invite_subject
    ON friends (invite_subject)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS friend_thread_shares (
      thread_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      can_prompt INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, friend_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS friend_thread_shares_friend_id
    ON friend_thread_shares (friend_id)
  `;

  /** Single-row table holding the profile this environment shows to friends. */
  yield* sql`
    CREATE TABLE IF NOT EXISTS friend_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT NOT NULL,
      avatar_color TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  const messageColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_messages)
  `;

  if (!messageColumns.some((column) => column.name === "author_json")) {
    yield* sql`
      ALTER TABLE projection_thread_messages
      ADD COLUMN author_json TEXT
    `;
  }
});
