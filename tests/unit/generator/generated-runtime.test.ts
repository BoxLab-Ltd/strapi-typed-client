import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { Generator } from '../../../src/generator/index.js'
import { mockSchema } from './fixtures/mock-schema.js'

/**
 * The interceptor weaving (onRequest/onResponse/onError) was previously covered
 * only by emitted-shape `.toContain` and strict typecheck — never EXECUTED. This
 * harness compiles the client to real .js, imports it, and drives it against a
 * fake fetch so the runtime behaviour is pinned: the onRequest partial-return
 * merge (method/body can't be silently dropped), onResponse-before-parse, and
 * onError observe-and-rethrow on both the network and HTTP error paths.
 */

interface Captured {
    url: string
    init: RequestInit
}

function recordingFetch(makeResponse: () => Response): {
    fetch: typeof fetch
    calls: Captured[]
} {
    const calls: Captured[] = []
    const fn = async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} })
        return makeResponse()
    }
    return { fetch: fn as unknown as typeof fetch, calls }
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

describe('generated client runtime behaviour', () => {
    let tmpDir: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let StrapiClient: new (config: any) => any

    beforeAll(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-types-rt-'))
        await new Generator(tmpDir).generate(mockSchema, {
            endpoints: [],
            format: 'js',
        })
        const mod = await import(
            pathToFileURL(path.join(tmpDir, 'index.js')).href
        )
        StrapiClient = mod.StrapiClient
    })

    afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

    it('sends a populate count, with its filters, as Strapi expects', async () => {
        const { fetch, calls } = recordingFetch(() => json({ data: [] }))
        const client = new StrapiClient({ baseURL: 'http://x', fetch })
        await client.projects.find({
            populate: {
                items: { count: true, filters: { title: { $eq: 'a' } } },
            },
        })
        const query = decodeURIComponent(calls[0]!.url.split('?')[1] ?? '')
        expect(query).toBe(
            'populate[items][count]=true&populate[items][filters][title][$eq]=a',
        )
    })

    // Strapi reads locale and status only from the query string on writes (#105)
    it('sends write params in the query string', async () => {
        const { fetch, calls } = recordingFetch(() => json({ data: {} }))
        const client = new StrapiClient({ baseURL: 'http://x', fetch })
        await client.items.create(
            { title: 'a' },
            { locale: 'fr', status: 'draft' },
        )
        await client.items.update('doc', { title: 'b' }, { locale: 'fr' })
        await client.items.delete('doc', { locale: '*' })
        await client.homepage.update({ title: 'c' }, { locale: 'de' })
        await client.homepage.delete({ locale: 'de' })

        expect(
            calls.map(c => `${c.init.method} ${decodeURIComponent(c.url)}`),
        ).toEqual([
            'POST http://x/api/items?locale=fr&status=draft',
            'PUT http://x/api/items/doc?locale=fr',
            'DELETE http://x/api/items/doc?locale=*',
            'PUT http://x/api/homepage?locale=de',
            'DELETE http://x/api/homepage?locale=de',
        ])
        expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
            data: { title: 'a' },
        })
    })

    it('still takes nextOptions as the second argument of the pre-params calls', async () => {
        const { fetch, calls } = recordingFetch(() => json({ data: {} }))
        const client = new StrapiClient({ baseURL: 'http://x', fetch })
        await client.items.create({ title: 'a' }, { headers: { 'x-a': '1' } })
        await client.items.update(
            'doc',
            { title: 'b' },
            { headers: { 'x-a': '2' } },
        )
        await client.items.delete('doc', { headers: { 'x-a': '3' } })
        await client.homepage.update(
            { title: 'c' },
            { headers: { 'x-a': '4' } },
        )

        expect(calls.map(c => c.url)).toEqual([
            'http://x/api/items',
            'http://x/api/items/doc',
            'http://x/api/items/doc',
            'http://x/api/homepage',
        ])
        expect(
            calls.map(c => (c.init.headers as Record<string, string>)['x-a']),
        ).toEqual(['1', '2', '3', '4'])
    })

    it('onRequest mutating in place reaches fetch', async () => {
        const { fetch, calls } = recordingFetch(() => json({ data: [] }))
        const client = new StrapiClient({
            baseURL: 'http://x',
            fetch,
            onRequest: (req: { headers: Record<string, string> }) => {
                req.headers['X-Token'] = 'abc'
            },
        })
        await client.items.find()
        expect(
            (calls[0].init.headers as Record<string, string>)['X-Token'],
        ).toBe('abc')
    })

    it('a partial onRequest return keeps method and body (no silent drop)', async () => {
        const { fetch, calls } = recordingFetch(() => json({ data: {} }))
        const client = new StrapiClient({
            baseURL: 'http://x',
            fetch,
            onRequest: (req: {
                url: string
                headers: Record<string, string>
            }) => ({
                url: req.url,
                headers: req.headers,
            }),
        })
        await client.items.create({ title: 'x' })
        expect(calls[0].init.method).toBe('POST')
        expect(calls[0].init.body).toBeTruthy()
    })

    it('an explicitly undefined field on the returned config clears it', async () => {
        const { fetch, calls } = recordingFetch(() => json({ data: {} }))
        const client = new StrapiClient({
            baseURL: 'http://x',
            fetch,
            onRequest: (req: Record<string, unknown>) => ({
                ...req,
                body: undefined,
            }),
        })
        await client.items.create({ title: 'x' })
        expect(calls[0].init.method).toBe('POST')
        expect(calls[0].init.body).toBeUndefined()
    })

    it('setting body to null in place still clears it (no `??` regression)', async () => {
        const { fetch, calls } = recordingFetch(() => json({ data: {} }))
        const client = new StrapiClient({
            baseURL: 'http://x',
            fetch,
            onRequest: (req: { body: unknown }) => {
                req.body = null
            },
        })
        await client.items.create({ title: 'x' })
        expect(calls[0].init.body).toBeNull()
    })

    it('a hook returning signal: undefined keeps the configured timeout signal', async () => {
        const { fetch, calls } = recordingFetch(() => json({ data: [] }))
        const client = new StrapiClient({
            baseURL: 'http://x',
            fetch,
            timeout: 5000,
            onRequest: (req: Record<string, unknown>) => ({
                ...req,
                signal: undefined,
            }),
        })
        await client.items.find()
        expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
    })

    it('onResponse observes the response before parse and the parsed result survives', async () => {
        const { fetch } = recordingFetch(() =>
            json({ data: { documentId: '1', title: 'hi' } }),
        )
        let clonedBody: unknown
        const client = new StrapiClient({
            baseURL: 'http://x',
            fetch,
            onResponse: async (res: Response) => {
                clonedBody = await res.clone().json()
            },
        })
        const result = await client.items.findOne('1')
        expect(clonedBody).toEqual({ data: { documentId: '1', title: 'hi' } })
        expect(result).toMatchObject({ documentId: '1', title: 'hi' })
    })

    it('onError observes a network failure and the call still rejects', async () => {
        const failingFetch = (async () => {
            throw new Error('boom')
        }) as unknown as typeof fetch
        let seen: { name?: string } | undefined
        const client = new StrapiClient({
            baseURL: 'http://x',
            fetch: failingFetch,
            onError: (err: { name?: string }) => {
                seen = err
            },
        })
        await expect(client.items.find()).rejects.toBeInstanceOf(Error)
        expect(seen?.name).toBe('StrapiConnectionError')
    })

    it('onError observes an HTTP error response and the call still rejects', async () => {
        const { fetch } = recordingFetch(() =>
            json(
                {
                    error: {
                        status: 400,
                        name: 'ValidationError',
                        message: 'bad',
                    },
                },
                400,
            ),
        )
        let seen: unknown
        const client = new StrapiClient({
            baseURL: 'http://x',
            fetch,
            onError: (err: unknown) => {
                seen = err
            },
        })
        await expect(client.items.find()).rejects.toBeInstanceOf(Error)
        expect(seen).toBeInstanceOf(Error)
    })
})
