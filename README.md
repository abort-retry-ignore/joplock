# Joplock

A secure, fast web client for [Joplin Server](https://github.com/laurent22/joplin).

Joplock runs as a sidecar alongside an unmodified Joplin Server instance, sharing the same Postgres database, sessions, notes, folders, and resources. It gives you a lightweight browser-based interface to your Joplin notes without modifying Joplin Server itself.  Keep using the other Joplin clients too, this won't interfere.

### Key Features

- **Full Joplin compatibility** -- desktop, mobile, CLI, and Joplock all work with the same account and data simultaneously
- **Low Resource usage** -- minimal memory usage on the client, fast and responsive
- **Security-first design** -- no private data stored on the client; sessions are cleaned up on logout; per-user settings and admin controls for user management
- **User creation from Joplock UI** -- create and modify users directly from Joplock settings page
- **Full database backup and restore** -- create and restore complete Postgres backups for both Joplin and Joplock data
- **Multi-factor authentication** -- optional TOTP-based MFA on top of standard Joplin sessions
- **Fast search** -- searches titles and note bodies directly in Postgres; optional live-as-you-type search
- **Near-instant autosave** -- debounced saves with conflict detection, hash-based deduplication, and an undo ring buffer with full note history snapshots
- **PWA support** -- installable as a home screen app on mobile and desktop with splash screens, offline indicator, and service worker shell
- **Server-side rendering** -- SSR with htmx for minimal client-side JavaScript; CodeMirror editor for markdown, rich preview mode with WYSIWYG editing

## Runtime Model

Joplock:
- reads Joplin data directly from the shared Postgres database
- validates the same `sessionId` cookie used by Joplin Server
- writes notes, folders, and resources through stock Joplin Server APIs

That keeps desktop, mobile, CLI, and Joplock compatible with the same account and data.

## Requirements

- docker
- an existng Joplin Server instance, or run the fullstack option

## Environment

All configuration is done directly in the compose files via inline environment variables with comments. No `.env` file is needed -- just edit the values in `docker-compose.yml` or `docker-compose.example-full.yml` before starting.

Backup and recovery configuration:

- `JOPLOCK_BACKUP_DIR` enables server-side full database backups
- `JOPLOCK_BACKUP_COMPRESSION` controls the `pg_dump` compression method, for example `zstd:19` or `gzip:9`
- `JOPLOCK_BACKUP_COMPRESSION_LEVEL=0-9` controls `pg_dump` compression for backup files
- `JOPLOCK_RECOVERY_ENABLED=true` enables the break-glass recovery page at `/recovery`
- `JOPLOCK_RECOVERY_PASSWORD` protects that recovery page

Important:

- Backups are only durable if `JOPLOCK_BACKUP_DIR` is mounted to persistent storage.
- Default backup compression is `zstd:19`, which is usually smaller than `gzip:9`.
- `JOPLOCK_BACKUP_COMPRESSION` takes precedence over `JOPLOCK_BACKUP_COMPRESSION_LEVEL`.
- Higher compression produces smaller backup files but may take longer to create.
- Recovery mode is for backup and restore only, not regular note usage.
- Restore replaces the entire shared Postgres database, including Joplock-owned tables.

## Docker

Published container image:
- `ghcr.io/abort-retry-ignore/joplock:latest`

### Sidecar Install

Use this when you already have Joplin Server and Postgres running elsewhere. Edit the environment values in `docker-compose.yml` to point at your existing setup, or copy into your existing compose. Then:

```bash
docker compose up -d
```

This pulls the pre-built image from GitHub Container Registry. To build from source instead:

```bash
docker compose -f docker-compose-build.yml up -d --build
```

On Linux, the compose files map `host.docker.internal` to the host gateway so Joplock can reach host services by default.

### Backup And Restore

Normal workflow:

1. Sign in as the configured Joplock admin.
2. Open `Settings -> Admin -> Backup & Restore`.
3. Create a backup or restore an existing server-side backup.

Break-glass workflow when normal Joplin login is unavailable:

1. Enable `JOPLOCK_RECOVERY_ENABLED=true` and set `JOPLOCK_RECOVERY_PASSWORD`.
2. Open `/recovery`.
3. Sign in with the recovery password.
4. Create or restore full database backups from there.

Before restoring:

1. Stop or quiesce Joplin Server if possible.
2. Stop active sync clients.
3. Expect the entire shared Postgres database to be replaced.

### Full Example Stack

Use this as a reference/demo stack with Postgres, Joplin Server, and Joplock together. Edit the values in `docker-compose.example-full.yml` as needed, then:

```bash
docker compose -f docker-compose.example-full.yml up -d
```

The full example uses the public `joplin/server:latest` image. Joplock is exposed on `http://localhost:5444` by default. Joplin Server is internal-only unless you add a port mapping.

The full example is meant as a working reference compose file. Adjust it for your real deployment.
