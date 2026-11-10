# Changelog

## 0.1.2 (2026-11-10)

- **Dependencies:** `@nestjs/common`, `@nestjs/graphql`, `@vendure/common`, `graphql-tag` and `typeorm` are now declared as peer dependencies. The plugin uses them at runtime, and before it relied on them being reachable through `@vendure/core`, which strict installs (Yarn Plug'n'Play, pnpm without hoisting) don't allow. Every Vendure project already has them.
- **Package:** the development tooling moved to the repository root, so the published package no longer lists any dev dependencies.

## 0.1.1 (2026-11-09)

- **Dashboard:** the extension no longer needs `gql.tada` installed in your project. Before, the Dashboard failed with "Failed to resolve import "gql.tada"" in projects without it.
- **Docs:** install commands for pnpm and yarn, and the Vite setting pnpm projects need for the Akeneo Sync page to appear.

## 0.1.0 (2026-11-09)

First release. Syncs run on demand from the dashboard (Settings > Akeneo Sync).

- **Connection:** Akeneo API credentials per Vendure channel, encrypted at rest, with a connection test.
- **Sync settings:** the Akeneo channel, which Akeneo locale feeds each Vendure language, and which category trees become Collections.
- **Category sync:** selected category trees become Collections, owned per Vendure channel. Synced products are added to them by an `akeneo-category` collection filter.
- **Product sync:**
  - Root product models become Products and their products become ProductVariants, with option groups for every variant axis.
  - Simple products become a Product with one variant.
  - Products moving between simple and variant are handled.
  - Names, descriptions and prices are synced, per family where needed.
  - "Sync changes" fetches only what changed in Akeneo since the last run.
- **Images:** image attributes and Asset Manager assets become Vendure Assets. Each file is downloaded once. Images added in Vendure are kept.
- **Cleanup:** finds products, variants, options, collections and images that Akeneo no longer has, and removes them after a preview and confirmation.
