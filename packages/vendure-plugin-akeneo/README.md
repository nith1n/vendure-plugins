# Akeneo Sync Plugin for Vendure

Sync your catalog from [Akeneo PIM](https://www.akeneo.com/) to [Vendure](https://vendure.io/): category trees become Collections, product models and products become Products and ProductVariants, and product images become Assets. Everything is configured and run from the Vendure Dashboard.

- **Categories:** pick which Akeneo category trees become Collections. Synced products are added to their categories' Collections automatically.
- **Products:** root product models become Products, and their products become variants, with an option group per variant axis. Simple products become a Product with a single variant.
- **Names, descriptions, prices, images:** from Akeneo's family settings by default, with global defaults and per-family overrides.
- **Locales:** map each Vendure language to an Akeneo locale.
- **Sync changes:** after a full sync, fetch only what changed in Akeneo since the last run.
- **Cleanup:** find what Akeneo no longer has (products, variants, options, collections, images), review it, and remove it.
- **Per channel:** each Vendure channel has its own Akeneo connection and settings, and only changes what its own sync created.

Syncs run on demand from the Dashboard and are processed by the Vendure worker, one page of Akeneo data per job.

## Requirements

- Vendure 3.8 or later, with the React Dashboard (`@vendure/dashboard`). The older Angular Admin UI is not supported.
- Akeneo 7.0 or later with REST API access: Akeneo Cloud (Serenity or Growth Edition), or a self-hosted Community or Enterprise Edition. The plugin uses the UUID-based product API, which Akeneo added in 7.0.
- Syncing Asset Manager images needs an edition with the Asset Manager: Enterprise Edition or Serenity. Image attributes work in every edition.

## Installation

```bash
npm install @nith1n/vendure-plugin-akeneo
# or
pnpm add @nith1n/vendure-plugin-akeneo
# or
yarn add @nith1n/vendure-plugin-akeneo
```

Add the plugin to your Vendure config:

```ts
// vendure-config.ts
import { AkeneoSyncPlugin } from '@nith1n/vendure-plugin-akeneo';

export const config: VendureConfig = {
  // ...
  plugins: [
    AkeneoSyncPlugin.init({
      // Encrypts the stored Akeneo client secret and password. Required.
      encryptionKey: process.env.AKENEO_ENCRYPTION_KEY,
    }),
  ],
};
```

Generate the encryption key once and keep it in your environment, for example `openssl rand -base64 32`. If the key changes, the stored Akeneo credentials can't be decrypted any more and have to be entered again.

The plugin adds database tables and custom fields, so generate and run a migration:

```bash
npx vendure migrate --generate AkeneoSync
npx vendure migrate --run
```

### Dashboard

The plugin ships a Dashboard extension: a **Settings > Akeneo Sync** page. If your project builds the Dashboard with the `vendureDashboardPlugin` Vite plugin (the default for new Vendure projects), the extension is picked up automatically from your Vendure config. Rebuild the Dashboard after installing.

**With pnpm**, also tell the Vite plugin where your `node_modules` is. By default it looks next to `@vendure/core`, which pnpm keeps in its own store, so plugins installed from npm aren't found and the page doesn't appear:

```ts
// vite.config.mts
vendureDashboardPlugin({
    // ...
    pluginPackageScanner: { nodeModulesRoot: join(__dirname, 'node_modules') },
}),
```

### Options

| Option                 | Default    | Description                                                                                                             |
| ---------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `encryptionKey`        |            | Key used to encrypt the Akeneo client secret and password at rest. Required to save or use a connection.                |
| `allowInsecureBaseUrl` | `false`    | Allow `http://` Akeneo URLs. Akeneo Cloud always uses HTTPS; only enable this for a local or self-hosted test instance. |
| `requestTimeoutMs`     | `10000`    | Timeout for each Akeneo API request. File downloads have a longer timeout of their own.                                 |
| `maxDownloadBytes`     | `52428800` | Largest image file downloaded from Akeneo (50 MB). Larger files are skipped and counted as skipped.                     |

### Akeneo connection

In Akeneo, create a connection under **Connect > Connection settings** and copy its client ID, secret, username and password. The connection's user needs a role with these Web API permissions:

- **Overall Web API access**;
- **List channels**, **List locales**, **List categories**, **List attributes**, **List attribute options**, **List families** and **List products** (which also covers product models and their media files);
- **List asset families** and **List assets**, if you sync Asset Manager images.

The plugin only reads from Akeneo, so the user doesn't need any edit permissions.

On Enterprise Edition and Serenity, the user's group permissions also decide which products, attribute groups and locales the API shows. Give the user's group view access to every category, attribute group and locale you sync. A product hidden from the user looks deleted to the plugin, so **Cleanup** would offer to remove it.

## Usage

Open **Settings > Akeneo Sync** in the Dashboard. Administrators need the **ManageAkeneoSync** permission. Each Vendure channel is set up separately: switch the active channel in the Dashboard to configure another one.

### 1. Connect

Enter the Akeneo URL (e.g. `https://acme.cloud.akeneo.com`) and the connection's credentials, then **Save connection**. Saving tests the connection.

### 2. Sync settings

- **General:** turn sync on, choose the Akeneo channel to read from, and map each Vendure language to one of its locales. Unmapped languages are not synced, and the channel's default language must be mapped.
- **Collections:** choose which Akeneo category trees become Collections, and whether the tree's root category becomes a Collection too. Categories are often organised for managing products rather than for shoppers, so pick only the trees you want in your store.
- **Products:** the defaults for every family.
  - **Product name:** a text attribute, or each family's label attribute.
  - **Description:** a text attribute, or not synced.
  - **Price:** a price attribute, or not synced. Only the channel's currencies are copied, and an empty Akeneo price never overwrites a Vendure price.
  - **Sync images:** each family's image attribute becomes the featured image, followed by the family's other image and asset collection attributes in Akeneo's attribute order.
- **Family overrides:** for families that differ, pick other attributes for the name, description, price or images. Each dropdown only lists the family's own attributes.

Settings left unset are managed in Vendure, and the sync doesn't touch them.

### 3. Sync

Run the **Category sync** first, then the **Product sync**. Both show their progress and the result of the last run. The product sync only includes products classified in the Akeneo channel's category tree.

- **Full sync** goes through every product. Run it the first time and after changing the sync settings.
- **Sync changes** only fetches products updated in Akeneo since the last completed run. It's offered once a full sync has completed with the current settings.

Re-running a sync is safe: anything already up to date is reported as unchanged.

### 4. Cleanup

The sync creates and updates, but never deletes. When products are deleted in Akeneo, or you deselect a category tree, the Vendure copies stay. **Find leftovers** lists them:

- products and variants no longer in the Akeneo channel;
- options and option groups no variant uses any more;
- collections of categories that are no longer synced;
- Akeneo images nothing uses any more.

Review the list and **Remove** to delete exactly that. Products and variants are soft-deleted, so past orders keep working. Collections that contain collections added by hand, and products that are also in another Vendure channel, are kept and listed with the reason.

## How Akeneo data maps to Vendure

| Akeneo                                       | Vendure                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Category in a selected tree                  | Collection, with an `akeneo-category` filter that includes the category's products                                                                     |
| Root product model                           | Product                                                                                                                                                |
| Sub product model (two-level family variant) | Nothing of its own; its values and axis reach the variants below it                                                                                    |
| Product with a parent model                  | ProductVariant of the root model's Product                                                                                                             |
| Product without a parent (simple product)    | Product with a single ProductVariant                                                                                                                   |
| Variant axis value                           | ProductOption in an option group named after the axis attribute                                                                                        |
| Main identifier (e.g. `sku`)                 | Variant SKU                                                                                                                                            |
| Enabled flag                                 | Variant enabled. When Akeneo changes it, the Product becomes enabled if any of its variants is, otherwise a Product disabled in Vendure stays disabled |
| Image attribute or Asset Manager asset       | Asset, downloaded once and shared by everything that uses the same file                                                                                |

Products moving between simple and variant in Akeneo are handled. Images added by hand in Vendure are kept: after the Akeneo images, or in your own order while the Akeneo images stay the same.

## Security

- **Credentials:** the client secret and password are encrypted at rest with your `encryptionKey` (AES-256-GCM). The API never returns them. They are only ever sent to the Akeneo URL they were entered for: changing the URL requires entering them again.
- **Permissions:** everything the plugin offers requires `ManageAkeneoSync` on the active channel, and each channel's settings, syncs and cleanup are separate.
- **Akeneo URL:** any HTTPS host can be configured, including internal addresses, since self-hosted Akeneo often runs on an internal network. Grant `ManageAkeneoSync` only to administrators you trust with that.
- **Content from Akeneo:** product descriptions are copied as Akeneo stores them, which may include HTML. As with descriptions entered in Vendure, sanitize them in your storefront. Image files are checked against Vendure's permitted file types; if you don't want SVG images, leave them out of `assetOptions.permittedFileTypes`.

## API and storefront

Synced Products, ProductVariants, Collections and Assets are regular Vendure entities, so your storefront uses them through the Shop API as usual. The plugin doesn't extend the Shop API.

It adds these custom fields, which are not exposed in the Shop API:

- `Product.akeneoCode`, `Product.akeneoUuid`, `ProductVariant.akeneoUuid`, `Collection.akeneoCode`, `Asset.akeneoCode`: the Akeneo identifiers, read-only.
- `Product.akeneoChannelId`, `Collection.akeneoChannelId`: the Vendure channel whose sync owns the entity. These are internal.

The Admin API extensions behind the Dashboard page all require `ManageAkeneoSync`:

- **Settings:** `akeneoConnectionSettings`, `saveAkeneoConnectionSettings`, `validateAkeneoCredentials`, `deleteAkeneoConnectionSettings` and `saveAkeneoSyncSettings`.
- **Live Akeneo options:** `akeneoChannels`, `akeneoCategoryTrees`, `akeneoAttributeChoices`, `akeneoFamilies` and `akeneoSuggestedLocaleMapping`.
- **Syncs:** `startAkeneoCategorySync` and `akeneoCategorySyncStatus`; `startAkeneoProductSync(changesOnly)`, `akeneoProductSyncStatus` and `akeneoProductSyncChangesSince`.
- **Cleanup:** `scanAkeneoLeftovers`, `removeAkeneoLeftovers(scanJobId)` and `akeneoCleanupStatus`.

The client secret and password are write-only: they are never returned by the API.

## Limitations

- Syncs are started by hand. There are no Akeneo webhooks or scheduled syncs yet.
- Attributes are not synced to Facets.
- Asset Manager assets whose image is only an external link (media link) are skipped.
- A product that another Vendure channel's sync already created is skipped, not added to the current channel.
- A changed image inside an Asset Manager asset, or a reorganised category tree, needs a full sync to show up.
- Collection descriptions and images are not synced.

## Development

This package lives in a pnpm workspace. From the repository root:

```bash
pnpm install
pnpm run dev      # Vendure dev server with the plugin, from packages/vendure-plugin-akeneo/dev-server
pnpm run check    # type-check
pnpm run test     # unit and end-to-end tests
pnpm run lint
pnpm run build    # build the package to dist/
```

The dev server reads its database settings and `AKENEO_ENCRYPTION_KEY` from `packages/vendure-plugin-akeneo/.env`.

The end-to-end tests in `e2e/` start a Vendure server with the plugin on an in-memory SQLite database, and a fake Akeneo API serving a small fixture catalog (`e2e/fake-akeneo/`), so they need neither a database nor an Akeneo instance. Dev-server migrations: `pnpm run migrate generate <Name>`, `pnpm run migrate run`, `pnpm run migrate revert`.

## License

MIT
