import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import * as ts from 'typescript'
import { Generator } from '../../../src/generator/index.js'
import type { ParsedEndpoint } from '../../../src/shared/endpoint-types.js'
import { mockSchema } from './fixtures/mock-schema.js'

// Content-API routes of other plugins, as the Strapi plugin reports them (#101)
const plugin = (
    pluginName: string,
    method: string,
    routePath: string,
    handler: string,
    types?: ParsedEndpoint['types'],
): ParsedEndpoint => {
    const [controller, action] = handler.split('.') as [string, string]
    return {
        method,
        path: routePath,
        handler: `plugin::${pluginName}.${handler}`,
        controller,
        action,
        pluginName,
        prefix: '',
        ...(types && { types }),
    }
}

const endpoints: ParsedEndpoint[] = [
    plugin(
        'navigation',
        'GET',
        '/navigation/render/:idOrSlug',
        'client.render',
    ),
    plugin(
        'navigation',
        'GET',
        '/navigation/render/:idOrSlug/:childUIKey',
        'client.renderChild',
    ),
    plugin('navigation', 'GET', '/navigation', 'client.readAll'),
    plugin('email', 'POST', '/email', 'email.send', {
        query: '{ dryRun?: boolean }',
        body: '{ to: string; subject?: string }',
        response: '{ sent: boolean }',
    }),
    plugin('sitemap', 'GET', '/sitemap.xml', 'core.sitemap'),
    // Collides with the `items` collection on StrapiClient
    plugin('items', 'GET', '/items/stats', 'stats.get'),
    // Same action in two controllers, and one named like a BaseAPI member
    plugin('comments', 'GET', '/comments/:relation', 'client.find'),
    plugin('comments', 'GET', '/comments/moderation', 'admin.find'),
    plugin('comments', 'POST', '/comments/raw', 'client.request'),
    plugin('broken', 'GET', '/broken/(.*)', 'x.y'),
    // users-permissions keeps its controller-based classes
    {
        method: 'GET',
        path: '/roles',
        handler: 'plugin::users-permissions.role.find',
        controller: 'role',
        action: 'find',
        pluginName: 'users-permissions',
    },
]

const ASSERTIONS = `import { StrapiClient } from './client'

const client = new StrapiClient({ baseURL: 'http://x' })

async function _assert() {
  // untyped response: unknown unless the caller names it
  const nav = await client.navigation.render('main')
  const _navUnknown: unknown extends typeof nav ? true : false = true
  const typed = await client.navigation.render<{ title: string }[]>('main', { type: 'TREE' })
  const _title: string | undefined = typed[0]?.title
  await client.navigation.renderChild('main', 'child')
  await client.navigation.readAll()

  // typed from the route schemas
  const sent = await client.email.send({ to: 'a@b.c' }, { dryRun: true })
  const _sent: boolean = sent.sent
  // @ts-expect-error - body follows the request schema
  await client.email.send({ subject: 'no recipient' })
  // @ts-expect-error - so does the query
  await client.email.send({ to: 'a' }, { dryRun: 'yes' })

  await client.sitemap.sitemap<string>()
  await client.itemsPlugin.get()
  await client.items.find()
  await client.comments.clientFind('rel')
  await client.comments.adminFind()
  await client.comments.clientRequest({ any: 'body' })
  await client.role.find()

  // @ts-expect-error - a route that can't be called gets no class
  void client.broken
  void [_navUnknown, _title, _sent]
}
void _assert
`

describe('plugin routes (#101)', () => {
    let tsDir: string
    let jsDir: string
    let clientSource: string
    let diagnostics: string[]

    beforeAll(async () => {
        tsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-types-pr-ts-'))
        jsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-types-pr-js-'))
        await new Generator(tsDir).generate(mockSchema, {
            endpoints,
            format: 'ts',
        })
        await new Generator(jsDir).generate(mockSchema, {
            endpoints,
            format: 'js',
        })
        clientSource = fs.readFileSync(path.join(tsDir, 'client.ts'), 'utf-8')

        const files = ['types.ts', 'client.ts', 'index.ts'].map(f =>
            path.join(tsDir, f),
        )
        const assertPath = path.join(tsDir, '__assert.ts')
        fs.writeFileSync(assertPath, ASSERTIONS)
        const program = ts.createProgram([...files, assertPath], {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            strict: true,
            noUncheckedIndexedAccess: true,
            noImplicitOverride: true,
            exactOptionalPropertyTypes: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            noPropertyAccessFromIndexSignature: true,
            skipLibCheck: true,
            noEmit: true,
        })
        diagnostics = ts
            .getPreEmitDiagnostics(program)
            .map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '))
    }, 60_000)

    afterAll(() => {
        fs.rmSync(tsDir, { recursive: true, force: true })
        fs.rmSync(jsDir, { recursive: true, force: true })
    })

    it('type-checks under the strictest flags, with the expected API surface', () => {
        expect(diagnostics).toEqual([])
    })

    it('groups by plugin and keeps users-permissions on its own classes', () => {
        expect(clientSource).toContain(
            'export class NavigationPluginAPI extends PluginRoutesAPI',
        )
        expect(clientSource).toContain('export namespace EmailPluginAPI {')
        expect(clientSource).not.toContain('UsersPermissionsPluginAPI')
        expect(clientSource).not.toContain('BrokenPluginAPI')
    })

    async function clientWith(
        respond: (url: string) => Response = () => Response.json({ ok: 1 }),
    ) {
        const calls: { url: string; init: RequestInit }[] = []
        const { StrapiClient } = await import(
            pathToFileURL(path.join(jsDir, 'index.js')).href
        )
        const client = new StrapiClient({
            baseURL: 'http://x',
            fetch: async (url: string, init: RequestInit) => {
                calls.push({ url, init })
                return respond(url)
            },
        })
        return { client, calls }
    }

    it('builds the URL from the final path, encoding params and adding the query', async () => {
        const { client, calls } = await clientWith()
        await expect(
            client.navigation.render('a/b c', { type: 'TREE' }),
        ).resolves.toEqual({ ok: 1 })
        expect(calls[0]!.url).toBe(
            'http://x/api/navigation/render/a%2Fb%20c?type=TREE',
        )
        await client.navigation.readAll()
        expect(calls[1]!.url).toBe('http://x/api/navigation')
    })

    it('sends a JSON body, and returns the body as is (no `data` unwrap)', async () => {
        const { client, calls } = await clientWith(() =>
            Response.json({ data: 1, meta: 2 }),
        )
        await expect(client.email.send({ to: 'a' })).resolves.toEqual({
            data: 1,
            meta: 2,
        })
        expect(calls[0]!.init.method).toBe('POST')
        expect(calls[0]!.init.body).toBe('{"to":"a"}')
    })

    it('returns text for a non-JSON response', async () => {
        const { client } = await clientWith(
            () =>
                new Response('<urlset/>', {
                    headers: { 'content-type': 'application/xml' },
                }),
        )
        await expect(client.sitemap.sitemap()).resolves.toBe('<urlset/>')
    })
})
