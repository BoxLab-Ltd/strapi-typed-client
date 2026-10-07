import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { Generator } from '../../../src/generator/index.js'
import type { ParsedEndpoint } from '../../../src/shared/endpoint-types.js'
import { mockSchema } from './fixtures/mock-schema.js'

/**
 * A custom method's declared return type and what it returns at runtime come
 * from the same `Endpoints.response` declaration, so they must agree: a
 * `{ data: T }` envelope is unwrapped to T, anything else is returned as the
 * controller sent it (#93). Driven against the compiled client so the emitted
 * runtime is what gets checked, on both content-type and standalone classes.
 */

const responses: Record<string, string | undefined> = {
    envelope: '{ data: { url: string } }',
    raw: '{ jwt: string }',
    withMeta: '{ data: { id: number }; meta: { total: number } }',
    untyped: undefined,
}

function endpointsFor(
    controller: string,
    base: string,
    handlerPrefix: string,
): ParsedEndpoint[] {
    return Object.entries(responses).map(([action, response]) => ({
        method: 'POST',
        path: `${base}/${action}`,
        handler: `${handlerPrefix}.${action}`,
        controller,
        action,
        ...(response ? { types: { response } } : {}),
    }))
}

const endpoints = [
    ...endpointsFor('item', '/items', 'item'),
    ...endpointsFor('otp', '/otp', 'otp'),
]

function respondWith(body: unknown): typeof fetch {
    return (async () =>
        new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch
}

describe.each([
    ['content-type', 'items'],
    ['standalone', 'otp'],
] as const)('custom endpoint response handling (%s)', (_kind, prop) => {
    let tmpDir: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let StrapiClient: new (config: any) => any

    beforeAll(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-types-resp-'))
        await new Generator(tmpDir).generate(mockSchema, {
            endpoints,
            format: 'js',
        })
        const mod = await import(
            pathToFileURL(path.join(tmpDir, 'index.js')).href
        )
        StrapiClient = mod.StrapiClient
    })

    afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

    async function call(action: string, body: unknown): Promise<unknown> {
        const client = new StrapiClient({
            baseURL: 'http://x',
            fetch: respondWith(body),
        })
        return client[prop][action]()
    }

    it('unwraps a declared { data } envelope', async () => {
        expect(await call('envelope', { data: { url: 'u' } })).toEqual({
            url: 'u',
        })
    })

    it('returns a response without an envelope as-is', async () => {
        expect(await call('raw', { jwt: 'token' })).toEqual({ jwt: 'token' })
    })

    it('keeps siblings of data instead of dropping them', async () => {
        const body = { data: { id: 1 }, meta: { total: 1 } }
        expect(await call('withMeta', body)).toEqual(body)
    })

    it('still unwraps data when no response type is declared', async () => {
        expect(await call('untyped', { data: { ok: true } })).toEqual({
            ok: true,
        })
    })
})
