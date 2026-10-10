// Data access, shaped like the Base44 SDK entities API (legacy positional forms).
//
// PORTING: in Base44, replace this file's internals with:
//
//   import { createClientFromRequest } from "npm:@base44/sdk";
//   export function getDb(req: Request) {
//     return createClientFromRequest(req).asServiceRole.entities;
//   }
//
// Every caller uses getDb(req).<Entity>.list/filter/get/create/update/count
// exactly as Base44 does, so nothing else changes. Locally each entity is
// backed by data/<Entity>.json (an array of records). Writes take a
// data/<Entity>.json.lock file, so the dev server and scripts can safely write
// the same data dir at the same time.

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

// ---------- file storage ----------

function dataDir(): URL {
  const override = Deno.env.get("DATA_DIR");
  if (override) {
    const abs = override.startsWith("/") ? override : `${Deno.cwd()}/${override}`;
    const url = new URL("file:///");
    url.pathname = abs.endsWith("/") ? abs : abs + "/"; // the setter escapes # and ?
    return url;
  }
  // Resolved relative to this module, never the process cwd.
  return new URL("../data/", import.meta.url);
}

function fileFor(entity: string): URL {
  return new URL(`${entity}.json`, dataDir());
}

async function readAll(entity: string): Promise<Row[]> {
  try {
    const text = await Deno.readTextFile(fileFor(entity));
    if (!text.trim()) return [];
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new DbError(`${entity}.json is not an array`);
    return parsed as Row[];
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
}

async function writeAll(entity: string, rows: Row[]): Promise<void> {
  const target = fileFor(entity);
  await Deno.mkdir(dataDir(), { recursive: true });
  const tmp = new URL(`${entity}.json.tmp-${crypto.randomUUID()}`, dataDir());
  await Deno.writeTextFile(tmp, JSON.stringify(rows, null, 2) + "\n");
  await Deno.rename(tmp, target);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cross-process lock: <entity>.json.lock exists while someone is writing. */
async function withFileLock<R>(entity: string, fn: () => Promise<R>): Promise<R> {
  await Deno.mkdir(dataDir(), { recursive: true });
  const lock = new URL(`${entity}.json.lock`, dataDir());
  for (let tries = 0;; tries++) {
    try {
      (await Deno.open(lock, { write: true, createNew: true })).close();
      break;
    } catch (err) {
      if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
      // A lock older than 10s was left by a crashed process: take it over.
      const age = Date.now() - ((await Deno.stat(lock).catch(() => null))?.mtime?.getTime() ?? Date.now());
      if (age > 10_000) await Deno.remove(lock).catch(() => {});
      else if (tries > 500) throw new DbError(`${entity}.json is locked`, 503);
      else await sleep(5 + Math.random() * 20);
    }
  }
  try {
    return await fn();
  } finally {
    await Deno.remove(lock).catch(() => {});
  }
}

// One promise chain per file so writes in this process queue up instead of
// fighting over the lock file.
const queues = new Map<string, Promise<unknown>>();
function serialize<R>(entity: string, fn: () => Promise<R>): Promise<R> {
  const key = fileFor(entity).href;
  const locked = () => withFileLock(entity, fn);
  const next = (queues.get(key) ?? Promise.resolve()).then(locked, locked);
  queues.set(key, next.catch(() => {}));
  return next;
}

// ---------- query helpers ----------

function newId(): string {
  // 24 hex chars, like a Mongo ObjectId (Base44 generates its own ids).
  return crypto.randomUUID().replaceAll("-", "").slice(0, 24);
}

function eq(a: unknown, b: unknown): boolean {
  if (b === null) return a === null || a === undefined;
  return a === b;
}

function needArray(op: string, a: unknown): unknown[] {
  if (!Array.isArray(a)) throw new DbError(`${op} needs an array`, 400);
  return a;
}

const OPERATORS: Record<string, (value: unknown, arg: unknown) => boolean> = {
  $eq: (v, a) => matchValue(v, a),
  $ne: (v, a) => !matchValue(v, a),
  $in: (v, a) => matchValue(v, needArray("$in", a)),
  $nin: (v, a) => !matchValue(v, needArray("$nin", a)),
  // deno-lint-ignore no-explicit-any
  $gt: (v, a) => v != null && (v as any) > (a as any),
  // deno-lint-ignore no-explicit-any
  $gte: (v, a) => v != null && (v as any) >= (a as any),
  // deno-lint-ignore no-explicit-any
  $lt: (v, a) => v != null && (v as any) < (a as any),
  // deno-lint-ignore no-explicit-any
  $lte: (v, a) => v != null && (v as any) <= (a as any),
  $exists: (v, a) => (v !== undefined) === Boolean(a),
};

/**
 * Mirrors MongoDB semantics (Base44 storage is Mongo-compatible):
 *  - scalar query vs scalar field: equality
 *  - array query value: "any of" (field equals any item, or array field shares any item)
 *  - scalar query vs array field (needs, languages): matches if the array contains it
 *  - null matches missing or null
 *  - a small set of operators: $eq $ne $in $nin $gt $gte $lt $lte $exists
 */
function matchValue(value: unknown, cond: unknown): boolean {
  if (Array.isArray(cond)) {
    return cond.some((c) => matchValue(value, c));
  }
  if (cond && typeof cond === "object" && !Array.isArray(cond)) {
    const entries = Object.entries(cond as Record<string, unknown>);
    if (entries.length && entries.every(([k]) => k.startsWith("$"))) {
      return entries.every(([op, arg]) => {
        const fn = OPERATORS[op];
        if (!fn) throw new DbError(`Unsupported filter operator ${op}`, 400);
        return fn(value, arg);
      });
    }
  }
  if (Array.isArray(value)) return value.some((v) => eq(v, cond));
  return eq(value, cond);
}

function matches(row: Row, query: Query): boolean {
  return Object.entries(query).every(([key, cond]) => {
    if (key === "$or" && Array.isArray(cond)) return cond.some((q) => matches(row, q as Query));
    if (key === "$and" && Array.isArray(cond)) return cond.every((q) => matches(row, q as Query));
    return matchValue(row[key], cond);
  });
}

function sortRows(rows: Row[], sort: string): Row[] {
  const desc = sort.startsWith("-");
  const field = sort.replace(/^[-+]/, "");
  if (!field) return rows;
  return [...rows].sort((a, b) => {
    const x = a[field], y = b[field];
    if (x === y) return 0;
    if (x === undefined || x === null) return 1; // missing values last
    if (y === undefined || y === null) return -1;
    const cmp = typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y));
    return desc ? -cmp : cmp;
  });
}

function page(rows: Row[], sort?: string, limit?: number, skip?: number, fields?: string[]): Row[] {
  const sorted = sortRows(rows, sort || DEFAULT_SORT);
  // Like the SDK: a falsy limit/skip (including 0) means the default.
  const start = Math.max(0, skip || 0);
  const out = sorted.slice(start, start + Math.max(0, limit || DEFAULT_LIMIT));
  if (!fields?.length) return out;
  return out.map((r) => {
    const picked: Row = { id: r.id };
    for (const f of fields) if (f in r) picked[f] = r[f];
    return picked;
  });
}

// ---------- entity factory ----------

function makeEntity<T>(entity: EntityName): Entity<T> {
  return {
    async list(sort, limit, skip, fields) {
      return page(await readAll(entity), sort, limit, skip, fields) as T[];
    },
    async filter(query, sort, limit, skip, fields) {
      const rows = (await readAll(entity)).filter((r) => matches(r, query ?? {}));
      return page(rows, sort, limit, skip, fields) as T[];
    },
    async count(query) {
      return (await readAll(entity)).filter((r) => matches(r, query ?? {})).length;
    },
    async get(id) {
      const row = (await readAll(entity)).find((r) => r.id === id);
      if (!row) throw new DbError(`${entity} ${id} not found`, 404);
      return row as T;
    },
    create(data) {
      return serialize(entity, async () => {
        const rows = await readAll(entity);
        const now = new Date().toISOString();
        const input = { ...(data as Row) };
        delete input.created_date;
        delete input.updated_date;
        const id = typeof input.id === "string" && input.id ? input.id : newId();
        if (rows.some((r) => r.id === id)) {
          throw new DbError(`${entity} ${id} already exists`, 409);
        }
        const row: Row = { ...input, id, created_date: now, updated_date: now };
        rows.push(row);
        await writeAll(entity, rows);
        return row as T;
      });
    },
    update(id, data) {
      return serialize(entity, async () => {
        const rows = await readAll(entity);
        const i = rows.findIndex((r) => r.id === id);
        if (i === -1) throw new DbError(`${entity} ${id} not found`, 404);
        const patch = { ...(data as Row) };
        delete patch.id;
        delete patch.created_date;
        const row: Row = { ...rows[i], ...patch, updated_date: new Date().toISOString() };
        rows[i] = row;
        await writeAll(entity, rows);
        return row as T;
      });
    },
  };
}

const db = Object.fromEntries(ENTITY_NAMES.map((n) => [n, makeEntity(n)])) as unknown as Db;

/** `req` is unused locally; Base44 needs it for createClientFromRequest(req). */
export function getDb(_req: Request): Db {
  return db;
}
