# Valoriz Vendure Plugins

A pnpm workspace of publishable Vendure plugins, laid out like Vendure's plugin template: each plugin in `packages/` has its own source, dev server and tests.

## Project Layout

- `packages/vendure-plugin-akeneo/` — the `@nith1n/vendure-plugin-akeneo` npm package
  - `src/` — the plugin; `src/index.ts` is the public API
  - `src/dashboard/` — React dashboard extension, shipped as source next to the compiled plugin
  - `dev-server/` — Vendure app used to develop and try the plugin: config, entries, migrations, `static/`, Vite config
  - `scripts/build.mjs` — compiles `src/` to `dist/` and copies the dashboard sources
- The root holds only shared tooling: ESLint, Prettier, the workspace config.

## Vendure Development Rules

- Read environment variables in `dev-server/vendure-config.ts` and pass values into plugins through `Plugin.init()` options.
- Create job queues in `onModuleInit()` or `onApplicationBootstrap()`, then reuse the queue when adding jobs.
- Pass `RequestContext` (`ctx`) to Vendure services and `TransactionalConnection` methods when it is available. Never use raw TypeORM `EntityManager.save()` for entities tied to requests or transactions.
- Vendure packages (`@vendure/*`, `@nestjs/*`, `typeorm`) are peer or dev dependencies of a plugin, never `dependencies`.
- Do not commit `.env` values or generated runtime data.
- Do not use `dbConnectionOptions.synchronize: true` for production data. The dev server uses migrations in `dev-server/migrations`; published plugins don't ship migrations, the host project generates them.

## Akeneo Sync Plugin Specifics

- **Dashboard UI**: Use modern React & TanStack via `@vendure/dashboard`. Do NOT write Angular modules or use `@vendure/admin-ui`.
- **Background Jobs**: All Akeneo catalog ingestion (categories, products, variants, assets) runs via `JobQueueService` on worker processes, in paginated batches. Syncs are started by hand from the dashboard; there are no webhooks yet.
- **Data Mapping**:
  - Akeneo Category Trees (only those selected in the sync settings) -> Vendure Collections, owned per Vendure channel.
  - Akeneo root Product Models (`parent: null`) -> Vendure Products (matched on `akeneoCode`).
  - Akeneo sub Product Models (second level of a two-level family variant) -> no Vendure entity; their values and axes flow into the variants below them.
  - Akeneo Products with a `parent` -> Vendure ProductVariants of the root model's Product (matched on `akeneoUuid`). Option groups come from the axes of every family variant level.
  - Akeneo simple Products (no `parent`) -> a Vendure Product with a single ProductVariant (both matched on `akeneoUuid`).
  - Handle products moving between simple and variant.
  - Attribute mappings (name, description, price, images) default to Akeneo's family settings, with global defaults and per-family overrides.
  - Akeneo images and Asset Manager assets -> Vendure Assets via `AssetService.create()`, keyed by Akeneo file code.
  - Attributes are not synced to Facets yet.
- **External Tracking**: Akeneo identifiers (`akeneoUuid`, `akeneoCode`) are indexed custom fields on Products, ProductVariants, Collections and Assets. `akeneoChannelId` records which Vendure channel's sync owns a Product or Collection; a sync only changes what its channel owns.

## Commands (from the repo root)

- Start the dev server: `pnpm run dev`
- Type-check: `pnpm run check`
- Build the packages: `pnpm run build`
- Lint and format: `pnpm run lint`, `pnpm run format:check`
- Dev-server migrations (in the plugin package): `pnpm run migrate generate <Name>`, `pnpm run migrate run`, `pnpm run migrate revert`
- Tests (in the plugin package): `pnpm run test`

## Quality Checks

- Run `pnpm run check`, `pnpm run lint` and `pnpm run format:check` after changing code, and `pnpm run build` before publishing.
- Run targeted tests for the package or feature you changed.
