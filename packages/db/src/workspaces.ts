// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { SqlClient, SqlError } from "@effect/sql"
import { Context, Effect, Layer, Schema } from "effect"
import type { ParseError } from "effect/ParseResult"
import { randomUUID } from "node:crypto"
import { Workspace, WorkspaceSummary, type PanelInstance } from "@nfi/api-contract"

/**
 * Durable workspace storage.
 *
 * Schema (see `migrateWorkspaces`):
 *
 * ```text
 * workspaces
 * ----------
 * id               TEXT PRIMARY KEY
 * name             TEXT NOT NULL
 * schema_version   INTEGER NOT NULL
 * version          INTEGER NOT NULL
 * layout_json      TEXT NOT NULL   -- recursive LayoutNode AST as JSON
 * active_panel_id  TEXT            -- nullable workspace focus
 * created_at       TEXT NOT NULL
 * updated_at       TEXT NOT NULL
 *
 * workspace_panels
 * ----------------
 * id                 TEXT PRIMARY KEY
 * workspace_id       TEXT NOT NULL REFERENCES workspaces(id)
 * widget_type        TEXT NOT NULL
 * widget_config_json TEXT NOT NULL
 * created_at         TEXT NOT NULL
 * updated_at         TEXT NOT NULL
 * ```
 *
 * The recursive layout tree stays a JSON document (normalizing it would buy
 * relational purity at the cost of recursive joins); widget instances are
 * rows because they carry independent identity + configuration. Panel
 * deletes are issued explicitly — no reliance on FK cascades.
 */

export const migrateWorkspaces: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        version INTEGER NOT NULL,
        layout_json TEXT NOT NULL,
        active_panel_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
  yield* sql`
      CREATE TABLE IF NOT EXISTS workspace_panels (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        widget_type TEXT NOT NULL,
        widget_config_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
  yield* sql`CREATE INDEX IF NOT EXISTS idx_workspace_panels_workspace ON workspace_panels (workspace_id)`
}).pipe(Effect.asVoid)

const WorkspaceRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  schemaVersion: Schema.Number,
  version: Schema.Number,
  layoutJson: Schema.String,
  activePanelId: Schema.NullOr(Schema.String),
  icon: Schema.NullOr(Schema.String),
  origin: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
})

const WorkspacePanelRow = Schema.Struct({
  id: Schema.String,
  widgetType: Schema.String,
  widgetConfigJson: Schema.String,
  title: Schema.NullOr(Schema.String),
})

const parseJson = (json: string): Effect.Effect<unknown, ParseError> => Schema.decodeUnknown(Schema.parseJson())(json)

const assembleWorkspace = (
  row: typeof WorkspaceRow.Type,
  panelRows: ReadonlyArray<typeof WorkspacePanelRow.Type>,
): Effect.Effect<Workspace, ParseError> =>
  Effect.gen(function* () {
    const layout = yield* parseJson(row.layoutJson)
    const panels: Record<string, PanelInstance> = {}
    for (const panelRow of panelRows) {
      panels[panelRow.id] = {
        id: panelRow.id as PanelInstance["id"],
        widgetType: panelRow.widgetType as PanelInstance["widgetType"],
        widgetConfig: yield* parseJson(panelRow.widgetConfigJson),
        title: panelRow.title ?? undefined,
      }
    }
    // Strict boundary: corrupt persisted state fails explicitly, never renders garbage.
    return yield* Schema.decodeUnknown(Workspace)({
      id: row.id,
      name: row.name,
      schemaVersion: row.schemaVersion,
      version: row.version,
      layout,
      panels,
      activePanelId: row.activePanelId,
      // NULL columns decode as absent optional fields.
      icon: row.icon ?? undefined,
      origin: row.origin === "user" ? "user" : undefined,
    })
  })

export interface WorkspaceRepoService {
  readonly listWorkspaces: () => Effect.Effect<ReadonlyArray<WorkspaceSummary>, SqlError.SqlError | ParseError>
  readonly loadWorkspace: (id: string) => Effect.Effect<Workspace | null, SqlError.SqlError | ParseError>
  readonly saveWorkspace: (workspace: Workspace) => Effect.Effect<Workspace, SqlError.SqlError | ParseError>
  readonly createWorkspace: (input: {
    readonly name?: string
    readonly workspace?: Workspace
  }) => Effect.Effect<Workspace, SqlError.SqlError | ParseError>
  readonly deleteWorkspace: (id: string) => Effect.Effect<string, SqlError.SqlError>
}

export class WorkspaceRepo extends Context.Tag("nfi/WorkspaceRepo")<WorkspaceRepo, WorkspaceRepoService>() {}

export const WorkspaceRepoLive: Layer.Layer<WorkspaceRepo, never, SqlClient.SqlClient> = Layer.effect(
  WorkspaceRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const loadPanels = (workspaceId: string) =>
      Effect.gen(function* () {
        const rows = yield* sql`
          SELECT id, widget_type AS widgetType, widget_config_json AS widgetConfigJson, title
          FROM workspace_panels
          WHERE workspace_id = ${workspaceId}
        `
        return yield* Schema.decodeUnknown(Schema.Array(WorkspacePanelRow))(rows)
      })

    const persistPanels = (workspaceId: string, workspace: Workspace, now: string) =>
      Effect.gen(function* () {
        yield* sql`DELETE FROM workspace_panels WHERE workspace_id = ${workspaceId}`
        for (const panel of Object.values(workspace.panels)) {
          const configJson = JSON.stringify(panel.widgetConfig ?? null)
          yield* sql`
            INSERT INTO workspace_panels (id, workspace_id, widget_type, widget_config_json, title, created_at, updated_at)
            VALUES (${panel.id}, ${workspaceId}, ${panel.widgetType}, ${configJson}, ${panel.title ?? null}, ${now}, ${now})
          `
        }
      })

    const upsertWorkspaceRow = (workspace: Workspace, now: string) =>
      Effect.gen(function* () {
        const layoutJson = JSON.stringify(yield* Schema.encode(Workspace.fields.layout)(workspace.layout))
        yield* sql`
          INSERT INTO workspaces (id, name, schema_version, version, layout_json, active_panel_id, icon, origin, created_at, updated_at)
          VALUES (${workspace.id}, ${workspace.name}, ${workspace.schemaVersion}, ${workspace.version}, ${layoutJson}, ${workspace.activePanelId}, ${workspace.icon ?? null}, ${workspace.origin ?? null}, ${now}, ${now})
          ON CONFLICT (id) DO UPDATE SET
            name = excluded.name,
            schema_version = excluded.schema_version,
            version = excluded.version,
            layout_json = excluded.layout_json,
            active_panel_id = excluded.active_panel_id,
            icon = excluded.icon,
            origin = excluded.origin,
            updated_at = excluded.updated_at
        `
      })

    return {
      listWorkspaces: () =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT id, name, updated_at AS updatedAt
            FROM workspaces
            ORDER BY updated_at DESC
          `
          return yield* Schema.decodeUnknown(Schema.Array(WorkspaceSummary))(rows)
        }),

      loadWorkspace: (id) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT
              id, name,
              schema_version AS schemaVersion,
              version,
              layout_json AS layoutJson,
              active_panel_id AS activePanelId,
              icon,
              origin,
              updated_at AS updatedAt
            FROM workspaces
            WHERE id = ${id}
            LIMIT 1
          `
          const decoded = yield* Schema.decodeUnknown(Schema.Array(WorkspaceRow))(rows)
          const row = decoded[0]
          if (!row) return null
          const panels = yield* loadPanels(row.id)
          return yield* assembleWorkspace(row, panels)
        }),

      saveWorkspace: (workspace) =>
        Effect.gen(function* () {
          const valid = yield* Schema.decodeUnknown(Workspace)(workspace)
          const now = new Date().toISOString()
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* upsertWorkspaceRow(valid, now)
              yield* persistPanels(valid.id, valid, now)
            }),
          )
          return valid
        }),

      createWorkspace: (input) =>
        Effect.gen(function* () {
          if (input.workspace) {
            const valid = yield* Schema.decodeUnknown(Workspace)(input.workspace)
            const now = new Date().toISOString()
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* upsertWorkspaceRow(valid, now)
                yield* persistPanels(valid.id, valid, now)
              }),
            )
            return valid
          }
          const now = new Date().toISOString()
          const id = `workspace-${randomUUID()}`
          const created = yield* Schema.decodeUnknown(Workspace)({
            id,
            name: input.name?.trim().length ? input.name.trim() : "Untitled workspace",
            schemaVersion: 1,
            version: 0,
            layout: {
              type: "tabs",
              id: `tabs-${randomUUID()}`,
              panels: [],
              activePanelId: null,
            },
            panels: {},
            activePanelId: null,
          })
          yield* sql`
            INSERT INTO workspaces (id, name, schema_version, version, layout_json, active_panel_id, created_at, updated_at)
            VALUES (${created.id}, ${created.name}, ${created.schemaVersion}, ${created.version}, ${JSON.stringify(created.layout)}, ${created.activePanelId}, ${now}, ${now})
          `
          return created
        }),

      deleteWorkspace: (id) =>
        Effect.gen(function* () {
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM workspace_panels WHERE workspace_id = ${id}`
              yield* sql`DELETE FROM workspaces WHERE id = ${id}`
            }),
          )
          return id
        }),
    } satisfies WorkspaceRepoService
  }),
)
