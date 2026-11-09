import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';

import { FakeAkeneoData, FakeProduct, FakeProductModel } from './fake-akeneo-data';

export const FAKE_CLIENT_ID = 'test-client';
export const FAKE_SECRET = 'test-secret';
export const FAKE_USERNAME = 'test-user';
export const FAKE_PASSWORD = 'test-password';

type SearchFilter = { operator: string; value?: unknown };
type Search = Record<string, SearchFilter[]>;

/**
 * A small stand-in for the Akeneo REST API: the endpoints the plugin calls, served from
 * in-memory data that a test may change between syncs. Like Akeneo, variant products include
 * the values of their product models, and lists are paginated with a `next` link.
 */
export class FakeAkeneoServer {
    /** Paths and query strings of the API requests received, oldest first. */
    readonly requests: string[] = [];
    /** Page size used when a request has no `limit`. */
    pageSize = 100;
    private server: Server | undefined;
    private origin = '';

    constructor(public data: FakeAkeneoData) {}

    get url(): string {
        return this.origin;
    }

    async start(): Promise<void> {
        this.server = createServer((req, res) => {
            this.handle(req, res).catch(e => send(res, 500, { message: String(e) }));
        });
        await new Promise<void>(resolve => this.server?.listen(0, '127.0.0.1', resolve));
        const { port } = this.server.address() as AddressInfo;
        this.origin = `http://127.0.0.1:${port}`;
    }

    async stop(): Promise<void> {
        await new Promise<void>(resolve => (this.server ? this.server.close(() => resolve()) : resolve()));
    }

    /** API requests whose path starts with the given prefix, e.g. `/api/rest/v1/products-uuid`. */
    requestsTo(pathPrefix: string): URL[] {
        return this.requests
            .map(r => new URL(r, this.origin))
            .filter(url => url.pathname.startsWith(pathPrefix));
    }

    private async handle(req: IncomingMessage, res: ServerResponse) {
        const url = new URL(req.url ?? '/', this.origin);
        this.requests.push(`${url.pathname}${url.search}`);

        if (url.pathname === '/api/oauth/v1/token' && req.method === 'POST') {
            return this.token(req, res);
        }
        if (req.headers.authorization !== 'Bearer fake-token') {
            return send(res, 401, { message: 'Invalid token' });
        }
        const path = url.pathname.replace(/^\/api\/rest\/v1/, '');
        const d = this.data;

        let m: RegExpMatchArray | null;
        if (path === '/channels') return this.list(res, url, d.channels);
        if (path === '/categories') return this.list(res, url, this.searchCategories(url));
        if ((m = path.match(/^\/categories\/([^/]+)$/))) return found(res, byCode(d.categories, m[1]));
        if (path === '/attributes') return this.list(res, url, this.searchAttributes(url));
        if (path === '/attribute-groups') return this.list(res, url, d.attributeGroups);
        if ((m = path.match(/^\/attributes\/([^/]+)\/options\/([^/]+)$/))) {
            return found(res, byCode(d.attributeOptions[decode(m[1])] ?? [], m[2]));
        }
        if ((m = path.match(/^\/attributes\/([^/]+)$/))) return found(res, byCode(d.attributes, m[1]));
        if (path === '/families') return this.list(res, url, d.families);
        if ((m = path.match(/^\/families\/([^/]+)\/variants\/([^/]+)$/))) {
            return found(res, byCode(d.familyVariants[decode(m[1])] ?? [], m[2]));
        }
        if ((m = path.match(/^\/families\/([^/]+)$/))) return found(res, byCode(d.families, m[1]));
        if ((m = path.match(/^\/product-models\/([^/]+)$/))) {
            const model = byCode(d.productModels, m[1]);
            return found(res, model && { ...model, values: this.withAttributeTypes(model.values) });
        }
        if (path === '/products-uuid') return this.list(res, url, this.searchProducts(url));
        if ((m = path.match(/^\/media-files\/(.+)\/download$/))) return this.file(res, decodePath(m[1]));
        if ((m = path.match(/^\/asset-media-files\/(.+)$/))) return this.file(res, decodePath(m[1]));
        if ((m = path.match(/^\/asset-families\/([^/]+)\/attributes\/([^/]+)$/))) {
            return found(res, byCode(d.assetFamilyAttributes[decode(m[1])] ?? [], m[2]));
        }
        if ((m = path.match(/^\/asset-families\/([^/]+)\/assets\/([^/]+)$/))) {
            return found(res, byCode(d.assets[decode(m[1])] ?? [], m[2]));
        }
        if ((m = path.match(/^\/asset-families\/([^/]+)$/))) return found(res, byCode(d.assetFamilies, m[1]));
        return send(res, 404, { message: `No fake route for ${path}` });
    }

    private async token(req: IncomingMessage, res: ServerResponse) {
        const body = JSON.parse(await readBody(req)) as { username?: string; password?: string };
        const basic = Buffer.from(`${FAKE_CLIENT_ID}:${FAKE_SECRET}`).toString('base64');
        const valid =
            req.headers.authorization === `Basic ${basic}` &&
            body.username === FAKE_USERNAME &&
            body.password === FAKE_PASSWORD;
        if (!valid) return send(res, 422, { code: 422, message: 'Invalid credentials' });
        return send(res, 200, { access_token: 'fake-token', expires_in: 3600, token_type: 'bearer' });
    }

    private list(res: ServerResponse, url: URL, items: unknown[]) {
        const limit = Number(url.searchParams.get('limit') ?? this.pageSize);
        const page = Number(url.searchParams.get('page') ?? 1);
        const pageItems = items.slice((page - 1) * limit, page * limit);
        const links: Record<string, { href: string }> = { self: { href: url.toString() } };
        if (page * limit < items.length) {
            const next = new URL(url.toString());
            next.searchParams.set('page', String(page + 1));
            links.next = { href: next.toString() };
        }
        return send(res, 200, { _links: links, current_page: page, _embedded: { items: pageItems } });
    }

    private file(res: ServerResponse, code: string) {
        const file = this.data.files[code];
        if (!file) return send(res, 404, { message: `No file ${code}` });
        res.writeHead(200, {
            'Content-Type': file.contentType,
            'Content-Disposition': `attachment; filename="${
                code
                    .split('/')
                    .pop()
                    ?.replace(/^[0-9a-f]{40}_/, '') ?? 'file'
            }"`,
        });
        res.end(file.bytes);
    }

    private searchCategories(url: URL) {
        const search = parseSearch(url);
        let categories = this.data.categories;
        if (search.is_root?.[0]?.value === true) categories = categories.filter(c => !c.parent);
        const parent = search.parent?.[0];
        if (parent?.operator === '=') {
            // Akeneo returns every descendant of the given category, not only its children
            const root = String(parent.value);
            categories = categories.filter(c => c.code !== root && this.ancestors(c.code).includes(root));
        }
        return categories;
    }

    private searchAttributes(url: URL) {
        const type = parseSearch(url).type?.[0];
        const types = Array.isArray(type?.value) ? (type.value as string[]) : undefined;
        return types ? this.data.attributes.filter(a => types.includes(a.type)) : this.data.attributes;
    }

    private searchProducts(url: URL) {
        const search = parseSearch(url);
        // Filter on what Akeneo returns: variants classified through their models included
        let products = this.data.products.map(p => this.withInheritedValues(p));
        const inChildren = search.categories?.find(f => f.operator === 'IN CHILDREN');
        if (inChildren) {
            const roots = inChildren.value as string[];
            products = products.filter(p =>
                p.categories.some(code => this.ancestors(code).some(a => roots.includes(a))),
            );
        }
        const updated = search.updated?.find(f => f.operator === '>');
        if (updated) {
            // Akeneo includes variant products whose product model changed
            const since = Date.parse(`${String(updated.value).replace(' ', 'T')}Z`);
            products = products.filter(p => this.lastUpdated(p) > since);
        }
        return products;
    }

    /** The category and its ancestors, nearest first. */
    private ancestors(code: string): string[] {
        const result: string[] = [];
        let current = this.data.categories.find(c => c.code === code);
        while (current) {
            result.push(current.code);
            current = current.parent ? this.data.categories.find(c => c.code === current?.parent) : undefined;
        }
        return result;
    }

    private modelChain(product: FakeProduct): FakeProductModel[] {
        const chain: FakeProductModel[] = [];
        let parent = product.parent;
        while (parent) {
            const model = this.data.productModels.find(m => m.code === parent);
            if (!model) break;
            chain.push(model);
            parent = model.parent;
        }
        return chain;
    }

    /** Akeneo includes each value's attribute type on product and product model values. */
    private withAttributeTypes(values: FakeProduct['values']): FakeProduct['values'] {
        return Object.fromEntries(
            Object.entries(values).map(([code, list]) => {
                const type = this.data.attributes.find(a => a.code === code)?.type;
                return [code, list.map(v => ({ ...v, attribute_type: type }))];
            }),
        );
    }

    private lastUpdated(product: FakeProduct): number {
        return Math.max(...[product, ...this.modelChain(product)].map(e => Date.parse(e.updated)));
    }

    private withInheritedValues(product: FakeProduct): FakeProduct {
        const models = this.modelChain(product).reverse();
        const values = this.withAttributeTypes(
            Object.assign({}, ...models.map(m => m.values), product.values) as FakeProduct['values'],
        );
        const categories = [...new Set([...models.flatMap(m => m.categories), ...product.categories])];
        return { ...product, values, categories };
    }
}

function parseSearch(url: URL): Search {
    const raw = url.searchParams.get('search');
    return raw ? (JSON.parse(raw) as Search) : {};
}

function byCode<T extends { code: string }>(items: T[], code: string): T | undefined {
    return items.find(item => item.code === decode(code));
}

function found(res: ServerResponse, item: unknown) {
    return item ? send(res, 200, item) : send(res, 404, { code: 404, message: 'Resource not found' });
}

function send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

function decode(segment: string): string {
    return decodeURIComponent(segment);
}

function decodePath(path: string): string {
    return path.split('/').map(decodeURIComponent).join('/');
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}
