// Base44 data layer. scripts/base44-sync.ts copies this over shared/db.ts in
// the generated base44/ tree. Same exports as shared/db.ts (Entity, Db,
// DbError, getDb), backed by createClientFromRequest(req).asServiceRole.entities.
//
// Ids: Base44 assigns its own record ids. Program and Place keep our CSV ids
// (prog-<slug>, place-<slug>) in a "key" field, and this layer translates:
//   - records come back with id = key (the Base44 id is kept as _b44id)
//   - get/update accept either our key or a Base44 id
//   - create moves data.id into key
//   - queries, sorts and field lists on "id" become "key"
// Link.from_id / Link.to_id already hold our keys. Submission, RequestLog and
// Link use Base44 ids as-is.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.53";
import type { EntityMap, EntityName } from "./schema.ts";
import { ENTITY_NAMES } from "./schema.ts";

type Row = Record<string, unknown>;
type Query = Record<string, unknown>;

export interface Entity<T> {
  /** list(sort = '-created_date', limit = 5000, skip = 0, fields?) -> T[] */
  list(sort?: string, limit?: number, skip?: number, fields?: string[]): Promise<T[]>;
  /** filter(query, sort = '-created_date', limit = 5000, skip = 0, fields?) -> T[] */
  filter(query: Query, sort?: string, limit?: number, skip?: number, fields?: string[]): Promise<T[]>;
  /** get(id) -> T, throws DbError(404) when missing */
  get(id: string): Promise<T>;
  /** create(data) -> T with id, created_date, updated_date */
  create(data: Partial<T>): Promise<T>;
  /** update(id, partial) -> T (shallow merge) */
  update(id: string, data: Partial<T>): Promise<T>;
  /** count(query?) -> number of matching records */
  count(query?: Query): Promise<number>;
  /** delete(id) -> removes the record; throws DbError(404) when missing */
  delete(id: string): Promise<void>;
}

export type Db = { [K in EntityName]: Entity<EntityMap[K]> };

export class DbError extends Error {
  readonly expose = true; // message is safe to show callers
  constructor(message: string, public status = 500) {
    super(message);
    this.name = "DbError";
  }
}

const DEFAULT_SORT = "-created_date";
const DEFAULT_LIMIT = 5000;
/** Entities whose records carry our CSV id in "key". */
const KEYED = new Set<string>(["Program", "Place"]);
const KEY_PREFIX = /^(prog|place)-/;

// deno-lint-ignore no-explicit-any
type SdkEntity = any;

/** Turn an SDK/network error into a DbError with a safe message. */
function toDbError(entity: string, err: unknown, what: string): DbError {
  if (err instanceof DbError) return err;
  const e = err as { status?: unknown; message?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : 0;
  if (status === 404) return new DbError(`${entity} ${what} not found`, 404);
  if (status === 400 || status === 422) {
    const msg = typeof e?.message === "string" ? e.message.slice(0, 300) : "invalid data";
    return new DbError(`${entity}: ${msg}`, 400);
  }
  if (status === 429) return new DbError("Database is busy, try again shortly", 503);
  console.error(`db: ${entity} ${what} failed`, status || (err instanceof Error ? err.name : typeof err));
  return new DbError("Database error", 502);
}

// ---------- id/key translation (Program, Place) ----------

function fromStore(entity: string, row: Row): Row {
  if (!row || typeof row !== "object" || !KEYED.has(entity)) return row;
  const { key, ...rest } = row;
  return { ...rest, id: typeof key === "string" && key ? key : row.id, _b44id: row.id };
}

function translateQuery(entity: string, query: Query | undefined): Query {
  if (!query) return {};
  if (!KEYED.has(entity)) return query;
  const out: Query = {};
  for (const [k, v] of Object.entries(query)) {
    if ((k === "$or" || k === "$and" || k === "$nor") && Array.isArray(v)) {
      out[k] = v.map((q) => translateQuery(entity, q as Query));
    } else if (k === "id") {
      out.key = v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function translateSort(entity: string, sort: string | undefined): string {
  const s = sort || DEFAULT_SORT;
  if (!KEYED.has(entity)) return s;
  return s.replace(/^([-+]?)id$/, "$1key");
}

function translateFields(entity: string, fields: string[] | undefined): string[] | undefined {
  if (!fields?.length) return undefined;
  if (!KEYED.has(entity)) return fields;
  const set = new Set(fields.map((f) => (f === "id" ? "key" : f)));
  set.add("key");
  return [...set];
}

/** Like the SDK and local db: a falsy limit/skip means the default. */
const lim = (limit?: number) => (limit && limit > 0 ? limit : DEFAULT_LIMIT);
const skp = (skip?: number) => (skip && skip > 0 ? skip : 0);

// ---------- entity factory ----------

function makeEntity<T>(entity: EntityName, store: () => SdkEntity): Entity<T> {
  const keyed = KEYED.has(entity);

  /** Our id (key) or a Base44 id -> the stored record, or DbError(404). */
  async function findRaw(id: string): Promise<Row> {
    if (typeof id !== "string" || !id) throw new DbError(`${entity} id is required`, 400);
    if (keyed && KEY_PREFIX.test(id)) {
      let rows: Row[];
      try {
        rows = await store().filter({ key: id }, DEFAULT_SORT, 1);
      } catch (err) {
        throw toDbError(entity, err, id);
      }
      if (!rows?.length) throw new DbError(`${entity} ${id} not found`, 404);
      return rows[0];
    }
    try {
      const row = await store().get(id);
      if (!row) throw new DbError(`${entity} ${id} not found`, 404);
      return row as Row;
    } catch (err) {
      throw toDbError(entity, err, id);
    }
  }

  const read = async (query: Query | undefined, sort?: string, limit?: number, skip?: number, fields?: string[]) => {
    try {
      const q = translateQuery(entity, query);
      const args = [translateSort(entity, sort), lim(limit), skp(skip) || undefined, translateFields(entity, fields)];
      const rows: Row[] = Object.keys(q).length ? await store().filter(q, ...args) : await store().list(...args);
      return (rows ?? []).map((r) => fromStore(entity, r)) as T[];
    } catch (err) {
      throw toDbError(entity, err, "read");
    }
  };

  return {
    list(sort, limit, skip, fields) {
      return read(undefined, sort, limit, skip, fields);
    },
    filter(query, sort, limit, skip, fields) {
      return read(query ?? {}, sort, limit, skip, fields);
    },
    async count(query) {
      const q = translateQuery(entity, query);
      try {
        const n = await store().count(Object.keys(q).length ? q : undefined);
        if (typeof n === "number") return n;
      } catch (err) {
        const status = (err as { status?: unknown })?.status;
        if (status !== 404 && status !== 405) throw toDbError(entity, err, "count");
      }
      // Fallback when the count endpoint is unavailable.
      return (await read(q)).length;
    },
    async get(id) {
      return fromStore(entity, await findRaw(id)) as T;
    },
    async create(data) {
      const input = { ...(data as Row) };
      delete input.created_date;
      delete input.updated_date;
      delete input._b44id;
      if (keyed) {
        const key = typeof input.id === "string" && input.id ? input.id : undefined;
        delete input.id;
        if (key) {
          let existing: Row[] = [];
          try {
            existing = await store().filter({ key }, DEFAULT_SORT, 1);
          } catch (err) {
            throw toDbError(entity, err, key);
          }
          if (existing?.length) throw new DbError(`${entity} ${key} already exists`, 409);
          input.key = key;
        }
      } else {
        delete input.id; // Base44 assigns ids
      }
      try {
        return fromStore(entity, await store().create(input)) as T;
      } catch (err) {
        throw toDbError(entity, err, "create");
      }
    },
    async update(id, data) {
      const raw = await findRaw(id);
      const patch = { ...(data as Row) };
      delete patch.id;
      delete patch.created_date;
      delete patch.updated_date;
      delete patch._b44id;
      if (keyed) delete patch.key;
      try {
        return fromStore(entity, await store().update(raw.id as string, patch)) as T;
      } catch (err) {
        throw toDbError(entity, err, id);
      }
    },
    async delete(id) {
      const raw = await findRaw(id);
      try {
        await store().delete(raw.id as string);
      } catch (err) {
        throw toDbError(entity, err, id);
      }
    },
  };
}

/**
 * On Base44, req must be the real incoming request (it carries the app id and
 * service credential). If the client cannot be built (e.g. no Base44 headers),
 * getDb still returns a Db, and every call rejects with DbError(503).
 */
export function getDb(req: Request): Db {
  // deno-lint-ignore no-explicit-any
  let entities: any = null;
  let failure: DbError | null = null;
  try {
    entities = createClientFromRequest(req).asServiceRole.entities;
  } catch (err) {
    console.error("db: createClientFromRequest failed:", err instanceof Error ? err.message.slice(0, 120) : typeof err);
    failure = new DbError("Database unavailable", 503);
  }
  const store = (name: string) => () => {
    if (failure) throw failure;
    return entities[name];
  };
  return Object.fromEntries(ENTITY_NAMES.map((n) => [n, makeEntity(n, store(n))])) as unknown as Db;
}
