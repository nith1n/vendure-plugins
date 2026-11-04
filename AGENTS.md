# queutty Project Instructions

This project was generated with `@vendure/create`.

## Project Layout

- Custom backend code belongs in `src/plugins`
- Runtime configuration is in `src/vendure-config.ts`
- Static assets and email templates live in `static`

## Vendure Development Rules

- Prefer implementing custom functionality as a Vendure plugin (`src/plugins/akeneo-plugin`).
- Use `npx vendure add` to scaffold plugins, entities, services, API extensions, and job queues.
- Read environment variables in `vendure-config.ts` and pass values into plugins through `Plugin.init()` options.
- Create job queues in `onModuleInit()` or `onApplicationBootstrap()`, then reuse the queue when adding jobs.
- Pass `RequestContext` (`ctx`) to Vendure services and `TransactionalConnection` methods when it is available. Never use raw TypeORM `EntityManager.save()` for entities tied to requests or transactions.
- Do not commit `.env` values or generated runtime data.
- Do not use `dbConnectionOptions.synchronize: true` for production data.

## Akeneo Sync Plugin Specifics

- **Plugin Location**: `src/plugins/akeneo-plugin`
- **Dashboard UI**: Use modern React & TanStack via `@vendure/dashboard`. Do NOT write Angular modules or use `@vendure/admin-ui`.
- **Background Jobs**: All Akeneo catalog ingestion (categories, families, products, variants, assets) must execute via `JobQueueService` on worker processes, processed in paginated batches.
- **Data Mapping**:
  - Akeneo Category Trees -> Vendure Collections.
  - Akeneo Attributes / Families -> Vendure Facets / FacetValues.
  - Akeneo Product Models -> Vendure Products.
  - Akeneo Products (with family_variant) -> Vendure ProductVariants.
  - Akeneo Assets -> Download stream directly to Vendure `AssetService.create()`.
- **External Tracking**: Index Akeneo identifiers (`akeneoUuid`, `akeneoCode`) as custom fields on Products and ProductVariants for fast lookups.
- **Webhooks**: Akeneo webhook controllers must return immediate `200 OK` responses after signature verification and push the payload to the job queue.

## Commands

- Start development: `pnpm run dev`
- Build: `pnpm run build`
- Run codegen: `pnpm run codegen`

## Quality Checks

- Run `pnpm run build` after changing backend code.
- Run targeted tests for the package or feature you changed.
