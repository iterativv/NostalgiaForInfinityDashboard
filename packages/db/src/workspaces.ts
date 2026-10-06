// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { SqlClient, SqlError } from "@effect/sql";
import { Context, Effect, Layer, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";
import { randomUUID } from "node:crypto";
import { Workspace, WorkspaceSummary } from "@nfi/api-contract";

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
 *
 * Panel identity is WORKSPACE-SCOPED: the primary key is
 * `(workspace_id, id)`, so two pages may both own a `panel-chart`. Databases
 * created before this constraint existed keyed panels by `id` alone — a
 * global uniqueness that preset pages (stable, shared panel ids like
 * `panel-chart` colliding with the Home dashboard's) violated on every save
 * with `SQLITE_CONSTRAINT_PRIMARYKEY`, surfacing as a 502 "Failed to execute
 * statement" and a permanently failing workspace save.
 * `migrateWorkspaces` rebuilds such tables in place on boot (auto-migration:
 * updating to a new version converges the schema without manual steps).
 */

export const migrateWorkspaces: Effect.Effect<
  void,
  SqlError.SqlError,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        version INTEGER NOT NULL,
        layout_json TEXT NOT NULL,
        active_panel_id TEXT,
        trellis_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
  yield* sql`
      CREATE TABLE IF NOT EXISTS workspace_panels (
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        id TEXT NOT NULL,
        widget_type TEXT NOT NULL,
        widget_config_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, id)
      )
    `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_workspace_panels_workspace ON workspace_panels (workspace_id)`;
  yield* rebuildGlobalKeyPanelsTable(sql);
}).pipe(Effect.asVoid);

/**
 * Column layout of `PRAGMA table_info` — `pk` is the 1-based position of the
 * column inside the primary key (0 when the column is not part of it).
 */
const TableColumnInfo = Schema.Struct({
  name: Schema.String,
  pk: Schema.Number,
});

/**
 * Pre-migration databases keyed `workspace_panels` by `id` alone (globally
 * unique panels). Panel ids are only meaningful within one workspace — the
 * sharing preset pages do every save — so such tables are rebuilt with the
 * composite `(workspace_id, id)` key. Rows map over 1:1 (duplicates across
 * workspaces become legal), and rows whose workspace vanished go with the
 * old table. No-op when the table already has the composite key (or does
 * not exist yet — fresh boots create it with the key above).
 */
const rebuildGlobalKeyPanelsTable = (
  sql: SqlClient.SqlClient,
): Effect.Effect<void, SqlError.SqlError> =>
  Effect.gen(function* () {
    const columns = yield* sql`
      SELECT name, pk FROM pragma_table_info ('workspace_panels')
    `;

    const decoded = Schema.decodeUnknownSync(Schema.Array(TableColumnInfo))(
      columns,
    );

    const keyColumns = decoded
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name);

    const composite =
      keyColumns.length === 2 &&
      keyColumns[0] === "workspace_id" &&
      keyColumns[1] === "id";

    if (composite) return;

    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          CREATE TABLE workspace_panels_scoped (
            workspace_id TEXT NOT NULL REFERENCES workspaces (id),
            id TEXT NOT NULL,
            widget_type TEXT NOT NULL,
            widget_config_json TEXT NOT NULL,
            title TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_id, id)
          )
        `;
        // Only copy panel columns the old table actually has: `title` was
        // added by a later ALTER, so the oldest tables lack it.
        const hasTitle = decoded.some((column) => column.name === "title");

        if (hasTitle) {
          yield* sql`
            INSERT INTO workspace_panels_scoped (workspace_id, id, widget_type, widget_config_json, title, created_at, updated_at)
            SELECT p.workspace_id, p.id, p.widget_type, p.widget_config_json, p.title, p.created_at, p.updated_at
            FROM workspace_panels p
            JOIN workspaces w ON w.id = p.workspace_id
          `;
        } else {
          yield* sql`
            INSERT INTO workspace_panels_scoped (workspace_id, id, widget_type, widget_config_json, created_at, updated_at)
            SELECT p.workspace_id, p.id, p.widget_type, p.widget_config_json, p.created_at, p.updated_at
            FROM workspace_panels p
            JOIN workspaces w ON w.id = p.workspace_id
          `;
        }

        yield* sql`DROP TABLE workspace_panels`;
        yield* sql`ALTER TABLE workspace_panels_scoped RENAME TO workspace_panels`;
        yield* sql`CREATE INDEX IF NOT EXISTS idx_workspace_panels_workspace ON workspace_panels (workspace_id)`;
      }),
    );
  });

const WorkspaceRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  schemaVersion: Schema.Number,
  version: Schema.Number,
  layoutJson: Schema.String,
  activePanelId: Schema.NullOr(Schema.String),
  icon: Schema.NullOr(Schema.String),
  origin: Schema.NullOr(Schema.String),
  trellisJson: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});

const WorkspacePanelRow = Schema.Struct({
  id: Schema.String,
  widgetType: Schema.String,
  widgetConfigJson: Schema.String,
  title: Schema.NullOr(Schema.String),
});

const parseJson = (json: string): Effect.Effect<unknown, ParseError> =>
  Schema.decodeUnknown(Schema.parseJson())(json);

const assembleWorkspace = (
  row: typeof WorkspaceRow.Type,
  panelRows: ReadonlyArray<typeof WorkspacePanelRow.Type>,
): Effect.Effect<Workspace, ParseError> =>
  Effect.gen(function* () {
    const layout = yield* parseJson(row.layoutJson);

    // Shared Trellis document (opaque): NULL/empty/corrupt = absent (the
    // renderer falls back to compiling `layout`). Corrupt JSON must not fail
    // the whole workspace load — it only affects arrangement.
    let trellis: unknown = undefined;

    if (row.trellisJson !== null && row.trellisJson !== undefined) {
      try {
        const parsed: unknown = JSON.parse(row.trellisJson);

        if (parsed instanceof Object) trellis = parsed;
      } catch {
        trellis = undefined;
      }
    }

    // Panel ids/widget types stay plain strings here; the Workspace decode
    // below validates and brands them along with the rest of the document.
    const panelEntries = yield* Effect.forEach(panelRows, (panelRow) =>
      Effect.map(
        parseJson(panelRow.widgetConfigJson),
        (widgetConfig) =>
          [
            panelRow.id,
            {
              id: panelRow.id,
              widgetType: panelRow.widgetType,
              widgetConfig,
              title: panelRow.title ?? undefined,
            },
          ] as const,
      ),
    );

    // Strict boundary: corrupt persisted state fails explicitly, never renders garbage.
    return yield* Schema.decodeUnknown(Workspace)({
      id: row.id,
      name: row.name,
      schemaVersion: row.schemaVersion,
      version: row.version,
      layout,
      panels: Object.fromEntries(panelEntries),
      activePanelId: row.activePanelId,
      // NULL columns decode as absent optional fields.
      icon: row.icon ?? undefined,
      origin: row.origin === "user" ? "user" : undefined,
      trellis,
    });
  });

export interface WorkspaceRepoService {
  readonly listWorkspaces: () => Effect.Effect<
    ReadonlyArray<WorkspaceSummary>,
    SqlError.SqlError | ParseError
  >;
  readonly loadWorkspace: (
    id: string,
  ) => Effect.Effect<Workspace | null, SqlError.SqlError | ParseError>;
  readonly saveWorkspace: (
    workspace: Workspace,
  ) => Effect.Effect<Workspace, SqlError.SqlError | ParseError>;
  readonly createWorkspace: (input: {
    readonly name?: string;
    readonly workspace?: Workspace;
  }) => Effect.Effect<Workspace, SqlError.SqlError | ParseError>;
  readonly deleteWorkspace: (
    id: string,
  ) => Effect.Effect<string, SqlError.SqlError>;
}

export class WorkspaceRepo extends Context.Tag("nfi/WorkspaceRepo")<
  WorkspaceRepo,
  WorkspaceRepoService
>() {}

export const WorkspaceRepoLive: Layer.Layer<
  WorkspaceRepo,
  never,
  SqlClient.SqlClient
> = Layer.effect(
  WorkspaceRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const loadPanels = (workspaceId: string) =>
      Effect.gen(function* () {
        const rows = yield* sql`
          SELECT id, widget_type AS widgetType, widget_config_json AS widgetConfigJson, title
          FROM workspace_panels
          WHERE workspace_id = ${workspaceId}
        `;

        return yield* Schema.decodeUnknown(Schema.Array(WorkspacePanelRow))(
          rows,
        );
      });

    const persistPanels = (
      workspaceId: string,
      workspace: Workspace,
      now: string,
    ) =>
      Effect.gen(function* () {
        yield* sql`DELETE FROM workspace_panels WHERE workspace_id = ${workspaceId}`;

        for (const panel of Object.values(workspace.panels)) {
          const configJson = JSON.stringify(panel.widgetConfig ?? null);
          yield* sql`
            INSERT INTO workspace_panels (id, workspace_id, widget_type, widget_config_json, title, created_at, updated_at)
            VALUES (${panel.id}, ${workspaceId}, ${panel.widgetType}, ${configJson}, ${panel.title ?? null}, ${now}, ${now})
          `;
        }
      });

    const upsertWorkspaceRow = (workspace: Workspace, now: string) =>
      Effect.gen(function* () {
        const layoutJson = JSON.stringify(
          yield* Schema.encode(Workspace.fields.layout)(workspace.layout),
        );

        const trellisJson =
          workspace.trellis === undefined
            ? null
            : JSON.stringify(workspace.trellis);

        yield* sql`
          INSERT INTO workspaces (id, name, schema_version, version, layout_json, active_panel_id, icon, origin, trellis_json, created_at, updated_at)
          VALUES (${workspace.id}, ${workspace.name}, ${workspace.schemaVersion}, ${workspace.version}, ${layoutJson}, ${workspace.activePanelId}, ${workspace.icon ?? null}, ${workspace.origin ?? null}, ${trellisJson}, ${now}, ${now})
          ON CONFLICT (id) DO UPDATE SET
            name = excluded.name,
            schema_version = excluded.schema_version,
            version = excluded.version,
            layout_json = excluded.layout_json,
            active_panel_id = excluded.active_panel_id,
            icon = excluded.icon,
            origin = excluded.origin,
            trellis_json = excluded.trellis_json,
            updated_at = excluded.updated_at
        `;
      });

    return {
      listWorkspaces: () =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT id, name, updated_at AS updatedAt
            FROM workspaces
            ORDER BY updated_at DESC
          `;

          return yield* Schema.decodeUnknown(Schema.Array(WorkspaceSummary))(
            rows,
          );
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
              trellis_json AS trellisJson,
              updated_at AS updatedAt
            FROM workspaces
            WHERE id = ${id}
            LIMIT 1
          `;

          const decoded = yield* Schema.decodeUnknown(
            Schema.Array(WorkspaceRow),
          )(rows);

          const row = decoded[0];

          if (!row) return null;
          const panels = yield* loadPanels(row.id);

          return yield* assembleWorkspace(row, panels);
        }),

      saveWorkspace: (workspace) =>
        Effect.gen(function* () {
          const valid = yield* Schema.decodeUnknown(Workspace)(workspace);
          const now = new Date().toISOString();
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* upsertWorkspaceRow(valid, now);
              yield* persistPanels(valid.id, valid, now);
            }),
          );

          return valid;
        }),

      createWorkspace: (input) =>
        Effect.gen(function* () {
          if (input.workspace) {
            const valid = yield* Schema.decodeUnknown(Workspace)(
              input.workspace,
            );

            const now = new Date().toISOString();
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* upsertWorkspaceRow(valid, now);
                yield* persistPanels(valid.id, valid, now);
              }),
            );

            return valid;
          }

          const now = new Date().toISOString();
          const id = `workspace-${randomUUID()}`;

          const created = yield* Schema.decodeUnknown(Workspace)({
            id,
            name: input.name?.trim().length
              ? input.name.trim()
              : "Untitled workspace",
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
          });

          yield* sql`
            INSERT INTO workspaces (id, name, schema_version, version, layout_json, active_panel_id, created_at, updated_at)
            VALUES (${created.id}, ${created.name}, ${created.schemaVersion}, ${created.version}, ${JSON.stringify(created.layout)}, ${created.activePanelId}, ${now}, ${now})
          `;

          return created;
        }),

      deleteWorkspace: (id) =>
        Effect.gen(function* () {
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM workspace_panels WHERE workspace_id = ${id}`;
              yield* sql`DELETE FROM workspaces WHERE id = ${id}`;
            }),
          );

          return id;
        }),
    } satisfies WorkspaceRepoService;
  }),
);
