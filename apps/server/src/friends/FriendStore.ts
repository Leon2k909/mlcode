/**
 * FriendStore — durable state for peer links.
 *
 * Three things live here and they answer three different questions:
 * - `friends` rows say who we are linked to, how to reach them (`httpBaseUrl` +
 *   `accessToken`), and how they reach us (`inviteSubject`);
 * - `friend_thread_shares` rows are the only authorization for guest access, so
 *   every guest RPC path ends up in `findShare`;
 * - `friend_identity` is the single-row profile we present to friends.
 *
 * The store deliberately hands back plain records and holds no policy. Deciding
 * whether a share permits an action belongs to FriendService.
 */
import {
  DEFAULT_FRIEND_AVATAR_COLOR,
  FriendAvatarColor,
  type FriendId,
  type FriendLinkStatus,
  type FriendProfile,
  type FriendThreadShare,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

export class FriendStoreError extends Schema.TaggedErrorClass<FriendStoreError>()(
  "FriendStoreError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Friend store operation ${this.operation} failed.`;
  }
}

const storeError = (operation: string) => (cause: unknown) =>
  new FriendStoreError({ operation, cause });

/**
 * A link as stored. `accessToken` is a credential for somebody else's
 * environment, so it is kept off the broadcast `Friend` schema and handed to our
 * own client only when it asks, through `friends.getLinkCredential`.
 */
export interface FriendRecord {
  readonly friendId: FriendId;
  readonly environmentId: string;
  readonly displayName: string;
  readonly avatarColor: FriendAvatarColor;
  readonly httpBaseUrl: string | null;
  readonly accessToken: string | null;
  readonly linkStatus: FriendLinkStatus;
  readonly inviteSubject: string;
  readonly announceCode: string | null;
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
}

const FriendRow = Schema.Struct({
  friendId: Schema.String,
  environmentId: Schema.String,
  displayName: Schema.String,
  avatarColor: Schema.String,
  httpBaseUrl: Schema.NullOr(Schema.String),
  accessToken: Schema.NullOr(Schema.String),
  linkStatus: Schema.String,
  inviteSubject: Schema.String,
  announceCode: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});

const ShareRow = Schema.Struct({
  threadId: Schema.String,
  friendId: Schema.String,
  canPrompt: Schema.Number,
  createdAt: Schema.String,
});

const IdentityRow = Schema.Struct({
  displayName: Schema.String,
  avatarColor: Schema.String,
});

const isAvatarColor = Schema.is(FriendAvatarColor);

/** Colors are a closed set; an unrecognized stored value falls back rather than failing a read. */
function toAvatarColor(value: string): FriendAvatarColor {
  return isAvatarColor(value) ? value : DEFAULT_FRIEND_AVATAR_COLOR;
}

function toLinkStatus(value: string): FriendLinkStatus {
  return value === "linked" || value === "pending" || value === "unreachable" ? value : "pending";
}

function toFriendRecord(row: typeof FriendRow.Type): FriendRecord {
  return {
    friendId: row.friendId as FriendId,
    environmentId: row.environmentId,
    displayName: row.displayName,
    avatarColor: toAvatarColor(row.avatarColor),
    httpBaseUrl: row.httpBaseUrl,
    accessToken: row.accessToken,
    linkStatus: toLinkStatus(row.linkStatus),
    inviteSubject: row.inviteSubject,
    announceCode: row.announceCode,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  };
}

function toShare(row: typeof ShareRow.Type): FriendThreadShare {
  return {
    threadId: row.threadId as ThreadId,
    friendId: row.friendId as FriendId,
    canPrompt: row.canPrompt === 1,
    createdAt: row.createdAt,
  };
}

export interface UpsertFriendInput {
  readonly friendId: FriendId;
  readonly environmentId: string;
  readonly displayName: string;
  readonly avatarColor: FriendAvatarColor;
  readonly httpBaseUrl: string | null;
  readonly accessToken: string | null;
  readonly linkStatus: FriendLinkStatus;
  readonly inviteSubject: string;
  readonly announceCode: string | null;
  readonly createdAt: string;
}

export class FriendStore extends Context.Service<
  FriendStore,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<FriendRecord>, FriendStoreError>;
    readonly findById: (
      friendId: FriendId,
    ) => Effect.Effect<Option.Option<FriendRecord>, FriendStoreError>;
    readonly findByEnvironmentId: (
      environmentId: string,
    ) => Effect.Effect<Option.Option<FriendRecord>, FriendStoreError>;
    /** Resolves an authenticated friend session back to the link that issued it. */
    readonly findByInviteSubject: (
      subject: string,
    ) => Effect.Effect<Option.Option<FriendRecord>, FriendStoreError>;
    readonly upsert: (input: UpsertFriendInput) => Effect.Effect<void, FriendStoreError>;
    readonly setOutboundLink: (input: {
      readonly friendId: FriendId;
      readonly httpBaseUrl: string | null;
      readonly accessToken: string | null;
      readonly linkStatus: FriendLinkStatus;
    }) => Effect.Effect<void, FriendStoreError>;
    /** Called once our client has delivered the reciprocal code. */
    readonly clearAnnounceCode: (friendId: FriendId) => Effect.Effect<void, FriendStoreError>;
    readonly markSeen: (input: {
      readonly friendId: FriendId;
      readonly seenAt: string;
    }) => Effect.Effect<void, FriendStoreError>;
    readonly remove: (friendId: FriendId) => Effect.Effect<void, FriendStoreError>;

    readonly listShares: () => Effect.Effect<ReadonlyArray<FriendThreadShare>, FriendStoreError>;
    readonly listSharesForFriend: (
      friendId: FriendId,
    ) => Effect.Effect<ReadonlyArray<FriendThreadShare>, FriendStoreError>;
    readonly findShare: (input: {
      readonly threadId: ThreadId;
      readonly friendId: FriendId;
    }) => Effect.Effect<Option.Option<FriendThreadShare>, FriendStoreError>;
    readonly putShare: (share: FriendThreadShare) => Effect.Effect<void, FriendStoreError>;
    readonly removeShare: (input: {
      readonly threadId: ThreadId;
      readonly friendId: FriendId;
    }) => Effect.Effect<void, FriendStoreError>;
    readonly removeSharesForThread: (threadId: ThreadId) => Effect.Effect<void, FriendStoreError>;

    readonly readIdentity: () => Effect.Effect<
      Option.Option<Omit<FriendProfile, "environmentId">>,
      FriendStoreError
    >;
    readonly writeIdentity: (input: {
      readonly displayName: string;
      readonly avatarColor: FriendAvatarColor;
      readonly updatedAt: string;
    }) => Effect.Effect<void, FriendStoreError>;
  }
>()("t3/friends/FriendStore") {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: FriendRow,
    execute: () =>
      sql`
        SELECT
          friend_id AS "friendId",
          environment_id AS "environmentId",
          display_name AS "displayName",
          avatar_color AS "avatarColor",
          http_base_url AS "httpBaseUrl",
          access_token AS "accessToken",
          link_status AS "linkStatus",
          invite_subject AS "inviteSubject",
          announce_code AS "announceCode",
          last_seen_at AS "lastSeenAt",
          created_at AS "createdAt"
        FROM friends
        ORDER BY display_name ASC, friend_id ASC
      `,
  });

  const findByIdRow = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: FriendRow,
    execute: (friendId) =>
      sql`
        SELECT
          friend_id AS "friendId",
          environment_id AS "environmentId",
          display_name AS "displayName",
          avatar_color AS "avatarColor",
          http_base_url AS "httpBaseUrl",
          access_token AS "accessToken",
          link_status AS "linkStatus",
          invite_subject AS "inviteSubject",
          announce_code AS "announceCode",
          last_seen_at AS "lastSeenAt",
          created_at AS "createdAt"
        FROM friends
        WHERE friend_id = ${friendId}
        LIMIT 1
      `,
  });

  const findByEnvironmentRow = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: FriendRow,
    execute: (environmentId) =>
      sql`
        SELECT
          friend_id AS "friendId",
          environment_id AS "environmentId",
          display_name AS "displayName",
          avatar_color AS "avatarColor",
          http_base_url AS "httpBaseUrl",
          access_token AS "accessToken",
          link_status AS "linkStatus",
          invite_subject AS "inviteSubject",
          announce_code AS "announceCode",
          last_seen_at AS "lastSeenAt",
          created_at AS "createdAt"
        FROM friends
        WHERE environment_id = ${environmentId}
        LIMIT 1
      `,
  });

  const findBySubjectRow = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: FriendRow,
    execute: (subject) =>
      sql`
        SELECT
          friend_id AS "friendId",
          environment_id AS "environmentId",
          display_name AS "displayName",
          avatar_color AS "avatarColor",
          http_base_url AS "httpBaseUrl",
          access_token AS "accessToken",
          link_status AS "linkStatus",
          invite_subject AS "inviteSubject",
          announce_code AS "announceCode",
          last_seen_at AS "lastSeenAt",
          created_at AS "createdAt"
        FROM friends
        WHERE invite_subject = ${subject}
        LIMIT 1
      `,
  });

  const listShareRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ShareRow,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          friend_id AS "friendId",
          can_prompt AS "canPrompt",
          created_at AS "createdAt"
        FROM friend_thread_shares
        ORDER BY created_at DESC
      `,
  });

  const listSharesForFriendRows = SqlSchema.findAll({
    Request: Schema.String,
    Result: ShareRow,
    execute: (friendId) =>
      sql`
        SELECT
          thread_id AS "threadId",
          friend_id AS "friendId",
          can_prompt AS "canPrompt",
          created_at AS "createdAt"
        FROM friend_thread_shares
        WHERE friend_id = ${friendId}
        ORDER BY created_at DESC
      `,
  });

  const findShareRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ threadId: Schema.String, friendId: Schema.String }),
    Result: ShareRow,
    execute: ({ threadId, friendId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          friend_id AS "friendId",
          can_prompt AS "canPrompt",
          created_at AS "createdAt"
        FROM friend_thread_shares
        WHERE thread_id = ${threadId} AND friend_id = ${friendId}
        LIMIT 1
      `,
  });

  const readIdentityRow = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: IdentityRow,
    execute: () =>
      sql`
        SELECT display_name AS "displayName", avatar_color AS "avatarColor"
        FROM friend_identity
        WHERE id = 1
        LIMIT 1
      `,
  });

  const list: FriendStore["Service"]["list"] = () =>
    listRows().pipe(
      Effect.mapError(storeError("FriendStore.list")),
      Effect.map((rows) => rows.map(toFriendRecord)),
    );

  const findById: FriendStore["Service"]["findById"] = (friendId) =>
    findByIdRow(friendId).pipe(
      Effect.mapError(storeError("FriendStore.findById")),
      Effect.map(Option.map(toFriendRecord)),
    );

  const findByEnvironmentId: FriendStore["Service"]["findByEnvironmentId"] = (environmentId) =>
    findByEnvironmentRow(environmentId).pipe(
      Effect.mapError(storeError("FriendStore.findByEnvironmentId")),
      Effect.map(Option.map(toFriendRecord)),
    );

  const findByInviteSubject: FriendStore["Service"]["findByInviteSubject"] = (subject) =>
    findBySubjectRow(subject).pipe(
      Effect.mapError(storeError("FriendStore.findByInviteSubject")),
      Effect.map(Option.map(toFriendRecord)),
    );

  const upsert: FriendStore["Service"]["upsert"] = (input) =>
    sql`
      INSERT INTO friends (
        friend_id,
        environment_id,
        display_name,
        avatar_color,
        http_base_url,
        access_token,
        link_status,
        invite_subject,
        announce_code,
        last_seen_at,
        created_at
      )
      VALUES (
        ${input.friendId},
        ${input.environmentId},
        ${input.displayName},
        ${input.avatarColor},
        ${input.httpBaseUrl},
        ${input.accessToken},
        ${input.linkStatus},
        ${input.inviteSubject},
        ${input.announceCode},
        NULL,
        ${input.createdAt}
      )
      ON CONFLICT (friend_id) DO UPDATE SET
        environment_id = excluded.environment_id,
        display_name = excluded.display_name,
        avatar_color = excluded.avatar_color,
        http_base_url = COALESCE(excluded.http_base_url, friends.http_base_url),
        access_token = COALESCE(excluded.access_token, friends.access_token),
        link_status = excluded.link_status,
        invite_subject = excluded.invite_subject,
        announce_code = excluded.announce_code
    `.pipe(Effect.asVoid, Effect.mapError(storeError("FriendStore.upsert")));

  const setOutboundLink: FriendStore["Service"]["setOutboundLink"] = (input) =>
    sql`
      UPDATE friends
      SET http_base_url = ${input.httpBaseUrl},
          access_token = ${input.accessToken},
          link_status = ${input.linkStatus}
      WHERE friend_id = ${input.friendId}
    `.pipe(Effect.asVoid, Effect.mapError(storeError("FriendStore.setOutboundLink")));

  const clearAnnounceCode: FriendStore["Service"]["clearAnnounceCode"] = (friendId) =>
    sql`UPDATE friends SET announce_code = NULL WHERE friend_id = ${friendId}`.pipe(
      Effect.asVoid,
      Effect.mapError(storeError("FriendStore.clearAnnounceCode")),
    );

  const markSeen: FriendStore["Service"]["markSeen"] = (input) =>
    sql`
      UPDATE friends SET last_seen_at = ${input.seenAt} WHERE friend_id = ${input.friendId}
    `.pipe(Effect.asVoid, Effect.mapError(storeError("FriendStore.markSeen")));

  const remove: FriendStore["Service"]["remove"] = (friendId) =>
    Effect.all(
      [
        sql`DELETE FROM friend_thread_shares WHERE friend_id = ${friendId}`,
        sql`DELETE FROM friends WHERE friend_id = ${friendId}`,
      ],
      { concurrency: 1 },
    ).pipe(Effect.asVoid, Effect.mapError(storeError("FriendStore.remove")));

  const listShares: FriendStore["Service"]["listShares"] = () =>
    listShareRows().pipe(
      Effect.mapError(storeError("FriendStore.listShares")),
      Effect.map((rows) => rows.map(toShare)),
    );

  const listSharesForFriend: FriendStore["Service"]["listSharesForFriend"] = (friendId) =>
    listSharesForFriendRows(friendId).pipe(
      Effect.mapError(storeError("FriendStore.listSharesForFriend")),
      Effect.map((rows) => rows.map(toShare)),
    );

  const findShare: FriendStore["Service"]["findShare"] = (input) =>
    findShareRow({ threadId: input.threadId, friendId: input.friendId }).pipe(
      Effect.mapError(storeError("FriendStore.findShare")),
      Effect.map(Option.map(toShare)),
    );

  const putShare: FriendStore["Service"]["putShare"] = (share) =>
    sql`
      INSERT INTO friend_thread_shares (thread_id, friend_id, can_prompt, created_at)
      VALUES (${share.threadId}, ${share.friendId}, ${share.canPrompt ? 1 : 0}, ${share.createdAt})
      ON CONFLICT (thread_id, friend_id) DO UPDATE SET can_prompt = excluded.can_prompt
    `.pipe(Effect.asVoid, Effect.mapError(storeError("FriendStore.putShare")));

  const removeShare: FriendStore["Service"]["removeShare"] = (input) =>
    sql`
      DELETE FROM friend_thread_shares
      WHERE thread_id = ${input.threadId} AND friend_id = ${input.friendId}
    `.pipe(Effect.asVoid, Effect.mapError(storeError("FriendStore.removeShare")));

  const removeSharesForThread: FriendStore["Service"]["removeSharesForThread"] = (threadId) =>
    sql`DELETE FROM friend_thread_shares WHERE thread_id = ${threadId}`.pipe(
      Effect.asVoid,
      Effect.mapError(storeError("FriendStore.removeSharesForThread")),
    );

  const readIdentity: FriendStore["Service"]["readIdentity"] = () =>
    readIdentityRow().pipe(
      Effect.mapError(storeError("FriendStore.readIdentity")),
      Effect.map(
        Option.map((row) => ({
          displayName: row.displayName,
          avatarColor: toAvatarColor(row.avatarColor),
        })),
      ),
    );

  const writeIdentity: FriendStore["Service"]["writeIdentity"] = (input) =>
    sql`
      INSERT INTO friend_identity (id, display_name, avatar_color, updated_at)
      VALUES (1, ${input.displayName}, ${input.avatarColor}, ${input.updatedAt})
      ON CONFLICT (id) DO UPDATE SET
        display_name = excluded.display_name,
        avatar_color = excluded.avatar_color,
        updated_at = excluded.updated_at
    `.pipe(Effect.asVoid, Effect.mapError(storeError("FriendStore.writeIdentity")));

  return {
    list,
    findById,
    findByEnvironmentId,
    findByInviteSubject,
    upsert,
    setOutboundLink,
    clearAnnounceCode,
    markSeen,
    remove,
    listShares,
    listSharesForFriend,
    findShare,
    putShare,
    removeShare,
    removeSharesForThread,
    readIdentity,
    writeIdentity,
  } satisfies FriendStore["Service"];
});

export const layer = Layer.effect(FriendStore, make);
