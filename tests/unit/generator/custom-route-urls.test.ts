import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { Generator } from '../../../src/generator/index.js'
import type { ParsedEndpoint } from '../../../src/shared/endpoint-types.js'
import { mockSchema } from './fixtures/mock-schema.js'

// Strapi serves a custom route at /api + its declared path, whichever controller it belongs to (#119)
const route = (
    method: string,
    routePath: string,
    handler: string,
): ParsedEndpoint => {
    const [controller, action] = handler.split('.') as [string, string]
    return { method, path: routePath, handler, controller, action }
}

const endpoints: ParsedEndpoint[] = [
    route('POST', '/items/:id/publish', 'item.publish'),
    route('POST', '/checkout', 'item.checkout'),
    route('GET', '/checkout/:token', 'item.status'),
    route('GET', '/item-stats/:id', 'item.stats'),
    route('GET', '/item/summary', 'item.summary'),
    route('GET', '/homepage/preview', 'homepage.preview'),
    route('GET', '/otp/:code', 'otp.verify'),
]

describe('custom route URLs (#119)', () => {
    let tmpDir: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any
    const urls: string[] = []

    beforeAll(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-types-urls-'))
        await new Generator(tmpDir).generate(mockSchema, {
            endpoints,
            format: 'js',
        })
        const { StrapiClient } = await import(
            pathToFileURL(path.join(tmpDir, 'index.js')).href
        )
        client = new StrapiClient({
            baseURL: 'http://x',
            fetch: async (url: string) => {
                urls.push(url)
                return Response.json({ data: null })
            },
        })
    })

    afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

    async function urlOf(call: () => Promise<unknown>): Promise<string> {
        await call()
        return urls.at(-1)!
    }

    it.each([
        [
            'a path under the collection endpoint',
            () => client.items.publish('7'),
            'http://x/api/items/7/publish',
        ],
        [
            'a path outside the collection endpoint',
            () => client.items.checkout({}),
            'http://x/api/checkout',
        ],
        [
            'an encoded path param',
            () => client.items.status('a/b?c'),
            'http://x/api/checkout/a%2Fb%3Fc',
        ],
        [
            'a path that only shares a prefix with the endpoint',
            () => client.items.stats('1'),
            'http://x/api/item-stats/1',
        ],
        [
            'a path under the singular name',
            () => client.items.summary(),
            'http://x/api/item/summary',
        ],
        [
            'a single type',
            () => client.homepage.preview(),
            'http://x/api/homepage/preview',
        ],
        [
            'a standalone controller',
            () => client.otp.verify('42'),
            'http://x/api/otp/42',
        ],
    ])('uses the declared path for %s', async (_case, call, expected) => {
        expect(await urlOf(call)).toBe(expected)
    })
})
