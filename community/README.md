# Corona community pilot (HumHub)

An isolated HumHub community for the demo. It is separate from the NYC Navigator app: own Compose project (`corona-community-pilot`), own port (**8090**), own MariaDB container and volumes. Stopping or deleting it cannot affect `pipeline/`, the CSVs, Base44 entities, imports, or the live MCP functions.

Image: the official `humhub/humhub:1.18.6`, pulled through `mirror.gcr.io` because Docker Hub rate-limited direct pulls (it is the same image).

## What it shows

- A public **Corona community** Space at `http://localhost:8090/s/corona-community/` for local questions (including housing) and resource corrections.
- A pinned post linking to the Base44 **suggest a resource** form: https://inmigracion-nyc.com/#/submit. A tip sent there becomes a **pending** Submission. Only a reviewed, approved tip can become a directory result.
- Two posts labeled **[SYNTHETIC DEMO POST: not a real person]**: a housing question (stays a discussion post) and a resource correction.

HumHub posts are **not** synced into directory search. An API bridge is a later step.

## Run it

```bash
cd community
docker compose up -d                 # first start takes ~20s

# First time only: install HumHub and create the admin account
Y='docker compose exec -T -u www-data -e HUMHUB_CONFIG__MODULES__INSTALLER__ENABLE_AUTO_SETUP=true -e HUMHUB_CONFIG__CONTROLLER_MAP__INSTALLER=humhub\modules\installer\commands\InstallController humhub /app/yii'
$Y installer/install-db
$Y installer/write-site-config "Corona Community Pilot" "pilot@example.com"
$Y installer/create-admin-account admin pilot-admin@example.com '<choose-a-password>'
$Y installer/set-base-url "http://localhost:8090"

./seed.sh                            # creates the Space and synthetic posts (safe to re-run)
./seed.sh https://other-form-url     # optional: point the pinned post at another form URL (updated in place)
```

Guests can read the Space without logging in. Log in as `admin` to post or moderate.

## Stop or remove

```bash
docker compose stop        # pause; data is kept
docker compose down -v     # delete the pilot and its database volumes
```
