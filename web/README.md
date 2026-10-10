# Web app (directory, submit form, review queue, insights)

React 18 + Vite 6, plain CSS, no UI or chart libraries. Spanish by default, with an English toggle on every page (remembered in localStorage). Hash routes:

| Route | Page | Who |
|---|---|---|
| `#/` | Directory: filter by need, borough and language spoken, plus text search. Cards show hours, languages, what to bring, a trust badge, a source link and "Revisado el ..." | public |
| `#/submit` | Suggest a resource. It becomes a **pending** Submission, and a person reviews every entry | public |
| `#/admin` | Review queue: approve (with optional edits) or reject. Approving publishes a Place with `trust: community` | admin |
| `#/insights` | "Tráfico de prueba / Test traffic" dashboard: requests by need, unmet by zip, language mix, channel mix | admin |

`src/api.ts` is the only file that calls the backend (`POST /functions/<name>`).

## Run locally

```sh
# 1. backend (repo root) — usually already running on :8787
deno task dev

# 2. frontend
cd web
npm install
npm run dev            # http://localhost:5180, proxies /functions -> http://localhost:8787
```

To point the frontend at a different backend, such as a test server with a copied `DATA_DIR`:

```sh
# repo root: test backend on its own port and data copy
cp -R data /tmp/navdata && PORT=8877 DATA_DIR=/tmp/navdata deno task dev
# web/
VITE_API_TARGET=http://localhost:8877 npm run dev
```

The admin pages ask once per tab for the admin token, which is the `ADMIN_TOKEN` value in `.env`. The token is kept in sessionStorage and sent as `x-admin-token`.

Build: `npm run build` writes to `web/dist/`. `npm run preview` serves that build on :5181 with the same proxy.

## Backend functions used

| Function | Body | Notes |
|---|---|---|
| `list_places` | `{need?, borough?, language?, q?, ui_language?}` | Sorted by trust, then name. Writes one RequestLog row (channel `web`) **only** when `need` is set. The UI filters search text in the browser, so typing creates no log rows |
| `submit_resource` | `{name, address, org?, org_type?, borough?, zip?, hours?, languages?, phone?, needs?, source_url?, notes?, website}` | `website` is a honeypot: when it is filled, the function returns the same thank-you and stores nothing. Rejects duplicate pending entries (same name and address). Never publishes |
| `review_queue` | `{action:"list", status?}` / `{action:"approve", id, edits?}` / `{action:"reject", id}` | Admin only. Approve creates `place-<slug>` (made unique), `trust: community`, `last_checked` today, and `source_url` from the submission or `community-submission:<id>`. Needs a 5-digit zip |
| `insights` | `{}` | Admin only. Aggregates RequestLog and always returns `test_traffic: true` |

The logic lives in `shared/web/*.ts`. Each `functions/<name>/entry.ts` is a thin `webFunction(...)` wrapper.

## Porting to Base44

- `src/api.ts`: swap `call()` for `base44.functions.invoke(name, body).then(r => r.data)`; the comment in that file shows how.
- Admin: `shared/auth.ts` becomes a check that `base44.auth.me()` has role `"admin"`. `AdminGate` then shows the page to signed-in admins, and the token input can go.
- Entities: Submission needs the extra optional fields `needs` (string[]), `notes` (string), `place_id` (string) and `reviewed_at` (string). Place needs an optional `needs` (string[]) for approved community places whose `org_type` is `other`. Without these fields Base44 may drop the values. The core flow still works, but an approved `other` place will not show up under a need filter.
