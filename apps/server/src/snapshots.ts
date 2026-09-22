// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Layer } from "effect"
import {
  DbConfigLive,
  SnapshotRepoLive,
  SettingsRepoLive,
  SqliteLive,
  WorkspaceRepoLive,
  InstanceRepoLive,
  UserRepoLive,
  migrate,
} from "@nfi/db"

/**
 * Shared persistence layers + migration.
 *
 * History recording moved to the live poller
 * (`capabilities/poller.ts`, the ONLY interval in the system): it refreshes
 * tracked capability snapshots and throttles sqlite writes to 60s, so the
 * terminal charts history even when freqtrade is down.
 */

/** Max points returned by the history capabilities. */
export const HISTORY_LIMIT = 500

// `merge` only unions requirements, so the internal DAG is wired vertically
// with `provide`: one config, one sqlite connection, one repo — shared by
// HTTP handlers, the migration and the poller via memoization.
const SqliteWithConfig = SqliteLive.pipe(Layer.provide(DbConfigLive))
const RepoWithSql = SnapshotRepoLive.pipe(Layer.provide(SqliteWithConfig))
const WorkspaceRepoWithSql = WorkspaceRepoLive.pipe(Layer.provide(SqliteWithConfig))
const InstanceRepoWithSql = InstanceRepoLive.pipe(Layer.provide(SqliteWithConfig))
const UserRepoWithSql = UserRepoLive.pipe(Layer.provide(SqliteWithConfig))
const SettingsRepoWithSql = SettingsRepoLive.pipe(Layer.provide(SqliteWithConfig))
export const DbLive = Layer.mergeAll(
  DbConfigLive,
  SqliteWithConfig,
  RepoWithSql,
  WorkspaceRepoWithSql,
  InstanceRepoWithSql,
  UserRepoWithSql,
  SettingsRepoWithSql,
)

export const MigrateLive = Layer.effectDiscard(migrate)
