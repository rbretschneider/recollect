# Deploying Recollect

One folder, two files, three commands.

```bash
mkdir -p /opt/recollect && cd /opt/recollect
curl -fsSLO https://raw.githubusercontent.com/rbretschneider/recollect/main/deploy/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/rbretschneider/recollect/main/deploy/env.example -o .env
```

Edit `.env` — replace `DB_PASSWORD`, `AUTH_TOKEN_SECRET` (`openssl rand -hex 32`),
and `LIBRARY_PATH` — then:

```bash
docker compose up -d
```

Open `http://<server>:8080`, create the admin account in the first-run wizard,
and indexing of the mounted folder starts. Migrations run automatically on
every boot; data lives in named volumes (`db-data`, `app-data`) and survives
redeploys.

## Auto-deploy (GitHub Actions)

Every push to `main` builds `ghcr.io/rbretschneider/recollect:latest` and — once
these repo secrets exist — SSHes in and rolls the stack:

- `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (a dedicated keypair whose
  public key is in the deploy user's `authorized_keys`; user must be able to
  run docker)

Manual roll at any time: `cd /opt/recollect && docker compose pull && docker compose up -d`.
Rollback: pin `image:` in docker-compose.yml to any commit-SHA tag from GHCR.
