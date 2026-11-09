# Dev server

A Vendure app for developing and trying the Akeneo Sync plugin. It loads the plugin from `../src`, so changes reload as you edit.

- **Start:** `pnpm run dev` from the repository root.
- **Database:** Postgres from `docker-compose.yml` (`docker compose up -d postgres_db`), configured through the package's `.env`.
- **Migrations:** in `migrations/`, managed with `pnpm run migrate generate <Name>`, `pnpm run migrate run` and `pnpm run migrate revert` from the package folder.
- **Files:** uploaded assets and email templates live in `static/`; generated GraphQL types for the dashboard in `gql/`.

This app is not part of the published package.
