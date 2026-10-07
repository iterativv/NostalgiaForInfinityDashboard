// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  HttpServerRequest,
  HttpServerResponse,
  type HttpClient,
} from "@effect/platform";
import { Cause, Effect, Either, Schema } from "effect";
import {
  InstanceRepo,
  SettingsRepo,
  SnapshotRepo,
  TradesRepo,
  UserRepo,
  WorkspaceRepo,
} from "@nfi/db";
import { FreqtradeClient } from "@nfi/freqtrade-client";
import type { Capability, TagGroupBy } from "@nfi/api-contract";
import {
  CLOSED_POSITIONS_EXPORT,
  OPEN_POSITIONS_EXPORT,
  OPEN_TRADES_EXPORT,
  RELATIVE_CLOSED_EXPORT,
  RELATIVE_OPEN_EXPORT,
  TAPE_EXPORT_COLUMNS,
  buildExportFilename,
  buildGroupedMerges,
  expandPositionRows,
  rowsToCellMatrix,
  rowsToCsv,
  rowsToJson,
  tagPerformanceExportColumns,
  tagPerformanceRelativeExportColumns,
  type ExportColumn,
  type FlatExportRow,
  type GroupedExportColumns,
  type SourcedClosedPosition,
  type SourcedOpenPosition,
} from "@nfi/export-core";
import {
  principalCanUse,
  toRelativeClosedPositions,
  toRelativeOpenPositions,
  type CapabilityContext,
  type Principal,
} from "@nfi/capabilities";
import { resolvePrincipalForRequest } from "./auth/session.js";
import { buildCapabilityContext } from "./capabilities/context.js";

/**
 * `GET /api/export` — server-side file exports for every windowed table.
 *
 * Tables load windows (50-row pages grown by scrolling, aggregates capped
 * by the row LIMIT), but an export must cover EVERYTHING matching the
 * current filter — the mirror holds the full history, so the file is
 * generated HERE from the same SQL WHERE the table's capability uses,
 * window-free (bounded only by the safety caps below). The serialization
 * columns come from `@nfi/export-core` — the definitions the client-side
 * export used — so downloads are cell-for-cell the table's export, just
 * unbounded.
 *
 * - AUTHORIZATION: mirrors the REST/SSE choke points — the caller
 *   (root | user | anonymous, from the session cookie) must hold the SAME
 *   capability the underlying table requires. Public pages can only ever
 *   export the `.relative` datasets (percent-only column sets — no prices,
 *   amounts or absolute profits exist in them by design); absolute
 *   datasets reject ungranted callers with 403 exactly like their
 *   capabilities do.
 * - FORMATS: `csv` (RFC 4180 + BOM), `xlsx` (SheetJS, grouped merges
 *   included) and `json` (grouped datasets nest orders under `Orders`).
 * - ERRORS are `{ error, detail? }` JSON bodies with real status codes
 *   (400 bad dataset/format/scope, 403 ungranted, 500 backend failure) —
 *   the web formats them through the shared `formatQueryError`.
 *
 * Registered NEXT TO the contract REST (`HttpLayerRouter.add`, the same
 * escape hatch `/api/stream` uses): downloads are raw responses, not
 * schema'd JSON — there is nothing for the typed client to decode.
 */

/** Hard row caps — exports are unbounded by the WINDOW, not by physics. */
const MAX_POSITION_ROWS = 100_000;

const MAX_GROUP_ROWS = 10_000;

const MAX_TAPE_ROWS = 100_000;

const ExportDataset = Schema.Literal(
  "open-trades",
  "open-positions",
  "closed-positions",
  "open-trades-relative",
  "closed-trades-relative",
  "tag-performance",
  "tag-performance-relative",
  "trade-tape",
);

type ExportDataset = typeof ExportDataset.Type;

type ExportFormat = "csv" | "xlsx" | "json";

/**
 * Capability the caller must hold per dataset — the id of the table the
 * export mirrors (fleet scope demands the fleet variant). Relative
 * datasets are instance-scoped only, exactly like their widgets.
 */
const DATASET_GUARDS: Record<
  ExportDataset,
  { instance: Capability; fleet: Capability | null }
> = {
  "open-trades": {
    instance: "instances.open-positions",
    fleet: "instances.positions-all",
  },
  "open-positions": {
    instance: "instances.open-positions",
    fleet: "instances.positions-all",
  },
  "closed-positions": {
    instance: "instances.closed-positions",
    fleet: "instances.closed-all",
  },
  "open-trades-relative": {
    instance: "instances.open-positions.relative",
    fleet: null,
  },
  "closed-trades-relative": {
    instance: "instances.closed-positions.relative",
    fleet: null,
  },
  "tag-performance": {
    instance: "instances.tag-performance",
    fleet: "instances.tag-performance-all",
  },
  "tag-performance-relative": {
    instance: "instances.tag-performance.relative",
    fleet: null,
  },
  "trade-tape": {
    instance: "instances.trade-tape",
    fleet: "instances.trade-tape-all",
  },
};

/** Ambient layers the export reads ride on (same set as the REST groups). */
type ExportEnv =
  | FreqtradeClient
  | HttpClient.HttpClient
  | WorkspaceRepo
  | InstanceRepo
  | SnapshotRepo
  | TradesRepo
  | UserRepo
  | SettingsRepo;

const errorResponse = (
  status: number,
  error: string,
  detail?: string,
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.unsafeJson(
    detail === undefined ? { error } : { error, detail },
    { status },
  );

/** `attachment` disposition with an RFC 5987 encoded file name. */
const contentDisposition = (filename: string): string =>
  `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;

const decodeParam = <A>(
  schema: Schema.Schema<A, A>,
  value: string | null,
): A | null => {
  if (value === null) return null;

  const decoded = Schema.decodeUnknownEither(schema)(value);

  return Either.isLeft(decoded) ? null : decoded.right;
};

const parseGroupBy = (value: string | null): TagGroupBy =>
  value === "exit" || value === "pair" || value === "strategy"
    ? value
    : "enter";

const parseMinTrades = (value: string | null): number | null => {
  if (value === null || value.trim() === "") return null;
  const n = Number.parseInt(value, 10);

  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : null;
};

/** Aggregation sort key — anything the widgets' order-by selects send. */
const parseAggregateSort = (value: string | null): string | null => {
  const allowed = new Set([
    "trades",
    "wins",
    "losses",
    "winrate",
    "profitAbs",
    "profitPctAvg",
  ]);

  return value !== null && allowed.has(value) ? value : null;
};

/** SheetJS workbook bytes for a cell matrix + grouped merge ranges. */
const xlsxBytes = async <T>(
  columns: ReadonlyArray<ExportColumn<T>>,
  rows: ReadonlyArray<T>,
): Promise<Uint8Array> => {
  // SheetJS is vendored (license: see packages/widgets/vendor) and loaded
  // lazily — only xlsx exports ever pay for it.
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet(rowsToCellMatrix(columns, rows));

  const merges = buildGroupedMerges(columns, rows);

  if (merges.length > 0) sheet["!merges"] = merges;

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, sheet, "export");

  // SAFETY: SheetJS `type: "buffer"` returns a Node Buffer (a Uint8Array
  // subclass) under Node runtimes; the view copy is byte-identical.
  return new Uint8Array(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer,
  );
};

const textResponse = (
  body: string,
  format: "csv" | "json",
  filename: string,
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.text(body, {
    contentType:
      format === "csv"
        ? "text/csv;charset=utf-8"
        : "application/json;charset=utf-8",
    headers: { "content-disposition": contentDisposition(filename) },
  });

const serialize = async <T>(
  format: ExportFormat,
  columns: ReadonlyArray<ExportColumn<T>>,
  rows: ReadonlyArray<T>,
  filename: string,
): Promise<HttpServerResponse.HttpServerResponse> => {
  if (format === "xlsx") {
    return HttpServerResponse.uint8Array(await xlsxBytes(columns, rows), {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      headers: { "content-disposition": contentDisposition(filename) },
    });
  }

  return textResponse(
    format === "csv" ? rowsToCsv(columns, rows) : rowsToJson(columns, rows),
    format,
    filename,
  );
};

const serializeGrouped = async <P, O>(
  format: ExportFormat,
  columns: GroupedExportColumns<FlatExportRow<P, O>>,
  positions: ReadonlyArray<P>,
  getOrders: (position: P) => ReadonlyArray<O> | undefined,
  filename: string,
): Promise<HttpServerResponse.HttpServerResponse> =>
  serialize(
    format,
    columns,
    expandPositionRows(positions, getOrders),
    filename,
  );

/** Fleet attribution name for a row's owning instance (absent when unknown). */
const instanceNameOf = (
  names: Map<string, string>,
  instanceId: string | null | undefined,
): string | undefined =>
  instanceId === null || instanceId === undefined
    ? undefined
    : names.get(instanceId);

/** Position rows tagged for the Bot column (fleet attribution). */
const withInstanceNames = <
  T extends { instanceId?: string | null; instanceName?: string },
>(
  rows: ReadonlyArray<T>,
  names: Map<string, string>,
): Array<
  Omit<T, "instanceId"> & { instanceId?: string; instanceName?: string }
> =>
  rows.map((row) => ({
    ...row,
    instanceId: row.instanceId ?? undefined,
    instanceName: row.instanceName ?? instanceNameOf(names, row.instanceId),
  }));

interface ExportParams {
  readonly dataset: ExportDataset;
  readonly format: ExportFormat;
  /** `undefined` = fleet (every instance). */
  readonly instanceId: string | undefined;
  readonly search: string | null;
  readonly groupBy: TagGroupBy;
  readonly minTrades: number | null;
  readonly sortBy: string | null;
  readonly sortDir: "asc" | "desc";
}

const readParams = (
  query: URLSearchParams,
): Either.Either<ExportParams, HttpServerResponse.HttpServerResponse> => {
  const dataset = decodeParam(ExportDataset, query.get("dataset"));
  const format = query.get("format") ?? "csv";

  if (dataset === null) {
    return Either.left(
      errorResponse(
        400,
        "unknown export dataset",
        `dataset: ${query.get("dataset") ?? ""}`,
      ),
    );
  }

  if (format !== "csv" && format !== "xlsx" && format !== "json") {
    return Either.left(
      errorResponse(400, "unknown export format", `format: ${format}`),
    );
  }

  return Either.right({
    dataset,
    format,
    instanceId: query.get("instanceId")?.trim() || undefined,
    search: normalizeSearch(query.get("search")),
    groupBy: parseGroupBy(query.get("groupBy")),
    minTrades: parseMinTrades(query.get("minTrades")),
    sortBy: parseAggregateSort(query.get("sortBy")),
    sortDir: query.get("sortDir") === "asc" ? "asc" : "desc",
  });
};

const normalizeSearch = (raw: string | null): string | null => {
  const needle = raw?.trim() ?? "";

  return needle.length === 0 ? null : needle;
};

export const exportRouteHandler = (
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, ExportEnv> =>
  // SAFETY: the dataset switch is total and every arm returns a response,
  // so the generator's implicit `undefined` tail is unreachable; the
  // trailing cast only reclaims the narrowed error channel.
  Effect.gen(function* () {
    const query = new URL(request.url, "http://localhost").searchParams;

    // -- Request shape first (400 before anything privileged) --------------
    const parsed = readParams(query);

    if (Either.isLeft(parsed)) return parsed.left;

    const resolved = parsed.right;

    // -- Authorization: same grant the mirrored table requires -------------
    const principal: Principal = yield* resolvePrincipalForRequest(request);
    const fleet = resolved.instanceId === undefined;

    const guard = fleet
      ? DATASET_GUARDS[resolved.dataset].fleet
      : DATASET_GUARDS[resolved.dataset].instance;

    if (guard === null) {
      return errorResponse(
        400,
        "dataset is instance-scoped",
        `${resolved.dataset} has no fleet variant — pass instanceId`,
      );
    }

    if (!principalCanUse(principal, guard)) {
      return errorResponse(
        403,
        `not authorized for ${guard}`,
        principal.kind === "anonymous"
          ? "sign in, or ask an admin to add the capability to the anonymous grant"
          : "ask an admin to grant this capability to your user",
      );
    }

    // -- Read the FULL matching set from the mirror ------------------------
    // Route code yields the shared context build instead of importing the
    // per-caller constructor (it stays inside `capabilities/context.ts`);
    // the spread reinstates the resolved caller's principal, so the
    // context reaches the data reads scoped to this request exactly as
    // before — the grant check above already gated everything.
    const base = yield* buildCapabilityContext;
    const ctx: CapabilityContext = { ...base, principal };
    const instanceNames = new Map<string, string>();

    if (fleet) {
      for (const instance of yield* ctx.instances.listInstances()) {
        instanceNames.set(instance.id, instance.name);
      }
    }

    const stamp = buildExportFilename(
      `${resolved.dataset}-${resolved.instanceId ?? "all"}`,
    );

    const filename = `${stamp}.${resolved.format}`;

    switch (resolved.dataset) {
      // -- Absolute open book (grouped with sub-orders) --------------------
      case "open-trades":
      case "open-positions": {
        const { positions } = yield* ctx.trades.listOpen({
          instanceId: resolved.instanceId ?? null,
          search: resolved.search,
          sort: null,
          dir: "desc",
          filter: null,
          limit: MAX_POSITION_ROWS,
        });

        // SAFETY: mirror open rows are OpenPosition + instanceId; the name
        // enrichment only narrows instanceId to a defined optional.
        return yield* Effect.promise(() =>
          serializeGrouped(
            resolved.format,
            resolved.dataset === "open-trades"
              ? OPEN_TRADES_EXPORT
              : OPEN_POSITIONS_EXPORT,
            withInstanceNames(
              positions,
              instanceNames,
            ) as SourcedOpenPosition[],
            (p) => p.orders,
            filename,
          ),
        );
      }

      // -- Absolute closed history (grouped with sub-orders) ---------------
      case "closed-positions": {
        const { positions } = yield* ctx.trades.listClosed({
          instanceId: resolved.instanceId ?? null,
          search: resolved.search,
          limit: MAX_POSITION_ROWS,
          offset: 0,
        });

        // SAFETY: mirror closed rows are ClosedPosition + instanceId; the
        // name enrichment only narrows instanceId to a defined optional.
        return yield* Effect.promise(() =>
          serializeGrouped(
            resolved.format,
            CLOSED_POSITIONS_EXPORT,
            withInstanceNames(
              positions,
              instanceNames,
            ) as SourcedClosedPosition[],
            (p) => p.orders,
            filename,
          ),
        );
      }

      // -- Relative open book (percent-only, instance-scoped) --------------
      case "open-trades-relative": {
        const service = yield* ctx.resolveInstance(resolved.instanceId ?? "");
        const balance = yield* service.getBalance();

        const { positions } = yield* ctx.trades.listOpen({
          instanceId: resolved.instanceId ?? null,
          search: resolved.search,
          searchNonSensitiveOnly: true,
          sort: null,
          dir: "desc",
          filter: null,
          limit: MAX_POSITION_ROWS,
        });

        const relative = toRelativeOpenPositions(
          { positions },
          balance.totalStake,
        ).positions;

        return yield* Effect.promise(() =>
          serializeGrouped(
            resolved.format,
            RELATIVE_OPEN_EXPORT,
            relative,
            (p) => p.orders,
            filename,
          ),
        );
      }

      // -- Relative closed history (percent-only, instance-scoped) --------
      case "closed-trades-relative": {
        const { positions } = yield* ctx.trades.listClosed({
          instanceId: resolved.instanceId ?? null,
          search: resolved.search,
          searchNonSensitiveOnly: true,
          limit: MAX_POSITION_ROWS,
          offset: 0,
        });

        const relative = toRelativeClosedPositions({
          positions,
          tradesCount: positions.length,
          totalTrades: positions.length,
        }).positions;

        return yield* Effect.promise(() =>
          serializeGrouped(
            resolved.format,
            RELATIVE_CLOSED_EXPORT,
            relative,
            (p) => p.orders,
            filename,
          ),
        );
      }

      // -- Aggregations (tag / strategy / pair) ----------------------------
      case "tag-performance":
      case "tag-performance-relative": {
        const relative = resolved.dataset === "tag-performance-relative";

        const aggregate = yield* ctx.trades.aggregate({
          instanceId: resolved.instanceId ?? null,
          search: resolved.search,
          searchNonSensitiveOnly: relative,
          groupBy: resolved.groupBy,
          minTrades: resolved.minTrades,
          sortBy: resolved.sortBy,
          sortDir: resolved.sortDir,
          limit: MAX_GROUP_ROWS,
          perInstance: fleet,
          bestEdgeMinTrades: null,
        });

        const columns = relative
          ? tagPerformanceRelativeExportColumns(resolved.groupBy)
          : tagPerformanceExportColumns(resolved.groupBy);

        return yield* Effect.promise(() =>
          serialize(
            resolved.format,
            columns,
            withInstanceNames(aggregate.rows, instanceNames),
            filename,
          ),
        );
      }

      // -- Trade tape (open/close events over the full history) -----------
      case "trade-tape": {
        const events = yield* ctx.trades.tape({
          instanceId: resolved.instanceId ?? null,
          limit: MAX_TAPE_ROWS,
          opens: true,
          closes: true,
        });

        return yield* Effect.promise(() =>
          serialize(
            resolved.format,
            TAPE_EXPORT_COLUMNS,
            withInstanceNames(events, instanceNames),
            filename,
          ),
        );
      }
    }
  }).pipe(
    // Every failure becomes a `{ error, detail }` body — never a bare 500
    // (the web formats these through the shared `formatQueryError`).
    Effect.catchAllCause((cause) => {
      const failure = Cause.squash(cause);

      return Effect.succeed(
        errorResponse(
          500,
          "export failed",
          failure instanceof Error ? failure.message : String(failure),
        ),
      );
    }),
  ) as Effect.Effect<HttpServerResponse.HttpServerResponse, never, ExportEnv>;
