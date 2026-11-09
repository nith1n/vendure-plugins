# Valoriz Vendure Plugins

Vendure plugins by Valoriz, one package per plugin in `packages/`:

| Package                                                                   | Description                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`@valoriz/vendure-plugin-akeneo`](packages/vendure-plugin-akeneo#readme) | Sync categories, products, variants and images from Akeneo PIM. |

## Development

```bash
pnpm install
pnpm run dev     # dev server of the Akeneo plugin
pnpm run check   # type-check every package
pnpm run test    # run every package's tests
pnpm run lint
pnpm run build   # build every package
```

Each package has its own dev server in `dev-server/`, with its settings in the package's `.env`.
