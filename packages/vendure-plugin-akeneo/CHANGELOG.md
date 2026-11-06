# Changelog

## 0.1.0

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
