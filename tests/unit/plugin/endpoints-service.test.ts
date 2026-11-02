import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import endpointsService from '../../../src/plugin/server/src/services/endpoints.js'
import type { ParsedEndpoint } from '../../../src/shared/endpoint-types.js'

function appWith(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-app-'))
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
        fs.writeFileSync(path.join(root, file), content)
    }
    return root
}

function service(warnings: string[] = []) {
    return endpointsService({
        strapi: { log: { debug() {}, warn: (m: string) => warnings.push(m) } },
    })
}

describe('endpoints service', () => {
    it('keeps extra types under their own file even after another handler read it', async () => {
        const root = appWith({
            'src/api/foo/controllers/index.ts':
                'export type Evt = { a: 1 }\nexport interface Endpoints { x: { response: Evt } }\n',
            'src/api/foo/routes/custom.ts':
                "export default { routes: [{ method: 'GET', path: '/foo/x', handler: 'foo.x' }] }\n",
        })
        try {
            const { endpoints, extraTypes } =
                await service().extractRoutesFromFiles(root)
            expect(endpoints[0]?.types).toEqual({ response: 'Evt' })
            expect(extraTypes).toEqual([
                {
                    controller: 'index',
                    typeName: 'Evt',
                    typeDefinition: '{ a: 1; }',
                },
            ])
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('warns once about a controller that does not parse', async () => {
        const root = appWith({
            'src/api/bad/controllers/bad.ts': 'export interface Endpoints {\n',
        })
        const warnings: string[] = []
        try {
            const svc = service(warnings)
            await svc.extractExtraTypes(root)
            await svc.extractExtraTypes(root)
            expect(warnings).toHaveLength(1)
            expect(warnings[0]).toMatch(/bad\.ts has a syntax error/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})

// Plugins as Strapi holds them after registration: routers carry `type` and `prefix`
function withPlugins(plugins: Record<string, { routes: unknown }>) {
    return endpointsService({
        strapi: {
            log: { debug() {}, warn() {} },
            plugins,
            plugin: (name: string) => plugins[name],
        },
    })
}

describe('routes of other plugins', () => {
    const route = (method: string, path: string, handler: string) => ({
        method,
        path,
        handler,
    })

    it('takes content-api routers by type, under any key, with their prefix', () => {
        const endpoints: ParsedEndpoint[] = []
        withPlugins({
            navigation: {
                routes: {
                    admin: {
                        type: 'admin',
                        prefix: '/navigation',
                        routes: [route('GET', '/settings', 'admin.config')],
                    },
                    'content-api': {
                        type: 'content-api',
                        prefix: '/navigation',
                        routes: [
                            route('GET', '/render/:idOrSlug', 'client.render'),
                            route('GET', '/', 'client.readAll'),
                        ],
                    },
                },
            },
            sitemap: {
                routes: {
                    frontend: {
                        type: 'content-api',
                        prefix: '',
                        routes: [route('GET', '/sitemap.xml', 'core.sitemap')],
                    },
                },
            },
            'admin-only': { routes: [route('GET', '/x', 'a.b')] },
        }).extractOtherPluginRoutes(endpoints)

        expect(endpoints.map(e => [e.method, e.path, e.handler])).toEqual([
            [
                'GET',
                '/navigation/render/:idOrSlug',
                'plugin::navigation.client.render',
            ],
            ['GET', '/navigation', 'plugin::navigation.client.readAll'],
            ['GET', '/sitemap.xml', 'plugin::sitemap.core.sitemap'],
        ])
        expect(endpoints[0]).toMatchObject({
            pluginName: 'navigation',
            controller: 'client',
            action: 'render',
            prefix: '',
        })
        expect(endpoints[0]!.types).toBeUndefined()
    })

    it("lets a route's own config.prefix override the router's, even when empty", () => {
        const endpoints: ParsedEndpoint[] = []
        withPlugins({
            comments: {
                routes: {
                    'content-api': {
                        type: 'content-api',
                        prefix: '/comments',
                        routes: [
                            {
                                ...route('GET', '/a', 'c.a'),
                                config: { prefix: '' },
                            },
                            {
                                ...route('GET', '/b', 'c.b'),
                                config: { prefix: '/x' },
                            },
                            { ...route('GET', '/c', 'c.c'), config: {} },
                        ],
                    },
                },
            },
        }).extractOtherPluginRoutes(endpoints)
        expect(endpoints.map(e => e.path)).toEqual([
            '/a',
            '/x/b',
            '/comments/c',
        ])
    })

    it('skips plugins the client covers itself and routes it cannot call', () => {
        const contentApi = (routes: unknown[]) => ({
            routes: { 'content-api': { type: 'content-api', routes } },
        })
        const endpoints: ParsedEndpoint[] = []
        withPlugins({
            'users-permissions': contentApi([
                route('GET', '/roles', 'role.find'),
            ]),
            upload: contentApi([route('GET', '/files', 'content-api.find')]),
            i18n: contentApi([route('GET', '/locales', 'locales.listLocales')]),
            'strapi-typed-client': contentApi([
                route('GET', '/schema', 'schema.get'),
            ]),
            other: contentApi([
                route('ALL', '/any', 'x.any'),
                { method: 'GET', path: '/fn', handler: () => {} },
                route('get', '/ok', 'x.ok'),
            ]),
        }).extractOtherPluginRoutes(endpoints)
        expect(endpoints.map(e => `${e.method} ${e.path}`)).toEqual([
            'GET /other/ok',
        ])
    })

    it('types query, body and response from the route Zod schemas', () => {
        const endpoints: ParsedEndpoint[] = []
        withPlugins({
            email: {
                routes: {
                    'content-api': {
                        type: 'content-api',
                        prefix: '/email',
                        routes: [
                            {
                                ...route('POST', '/', 'email.send'),
                                request: {
                                    query: {
                                        dryRun: z.boolean().optional(),
                                        locale: z.string(),
                                    },
                                    body: {
                                        'application/json': z.object({
                                            to: z.string(),
                                            subject: z.string().optional(),
                                        }),
                                    },
                                },
                                response: z.object({ sent: z.boolean() }),
                            },
                            {
                                ...route('GET', '/any', 'email.any'),
                                response: z.any(),
                            },
                        ],
                    },
                },
            },
        }).extractOtherPluginRoutes(endpoints)
        expect(endpoints[0]!.types).toEqual({
            query: '{ dryRun?: boolean; locale: string }',
            body: '{ to: string; subject?: string }',
            response: '{ sent: boolean }',
        })
        expect(endpoints[1]!.types).toBeUndefined()
    })
})
