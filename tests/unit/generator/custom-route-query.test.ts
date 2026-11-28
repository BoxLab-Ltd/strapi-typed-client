import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import * as ts from 'typescript'
import { Generator } from '../../../src/generator/index.js'
import type { ParsedEndpoint } from '../../../src/shared/endpoint-types.js'
import { mockSchema } from './fixtures/mock-schema.js'

// `query` declared in a controller's Endpoints becomes a typed `params` argument (#120)
const route = (
    method: string,
    routePath: string,
    handler: string,
    types?: ParsedEndpoint['types'],
): ParsedEndpoint => {
    const [controller, action] = handler.split('.') as [string, string]
    return {
        method,
        path: routePath,
        handler,
        controller,
        action,
        ...(types && { types }),
    }
}

const endpoints: ParsedEndpoint[] = [
    route('GET', '/directory', 'directory.list', {
        query: '{ region?: string; area?: string }',
        response: '{ total: number }',
    }),
    route('GET', '/search', 'search.run', {
        query: '{ q: string; page?: number }',
    }),
    route('POST', '/items/:id/import', 'item.import', {
        query: '{ dryRun?: boolean }',
        body: '{ rows: string[] }',
    }),
    route('POST', '/reports', 'report.build', {
        query: "{ format: 'csv' | 'pdf' }",
    }),
    route('GET', '/otp/:code', 'otp.verify'),
]

const ASSERTIONS = `import { StrapiClient } from './client'

const client = new StrapiClient({ baseURL: 'http://x' })

async function _assert() {
  const listed = await client.directory.list({ region: 'north' })
  const _total: number = listed.total
  await client.directory.list()
  await client.directory.list(undefined, { revalidate: 60 })
  // @ts-expect-error - the query follows the declared type
  await client.directory.list({ region: 1 })

  await client.search.run({ q: 'x', page: 2 })
  // @ts-expect-error - a required key makes the query required
  await client.search.run()

  await client.items.import('1', { rows: [] }, { dryRun: true })
  await client.items.import('1', { rows: [] })

  await client.report.build(undefined, { format: 'csv' })
  // @ts-expect-error - so it can't be left out after the body either
  await client.report.build(undefined)

  // a route without a declared query keeps its signature
  await client.otp.verify('42', { revalidate: 60 })
  void _total
}
void _assert
`

describe('custom route query params (#120)', () => {
    let tsDir: string
    let jsDir: string
    let diagnostics: string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any
    const urls: string[] = []

    beforeAll(async () => {
        tsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-types-q-ts-'))
        jsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-types-q-js-'))
        await new Generator(tsDir).generate(mockSchema, {
            endpoints,
            format: 'ts',
        })
        await new Generator(jsDir).generate(mockSchema, {
            endpoints,
            format: 'js',
        })

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

        const { StrapiClient } = await import(
            pathToFileURL(path.join(jsDir, 'index.js')).href
        )
        client = new StrapiClient({
            baseURL: 'http://x',
            fetch: async (url: string) => {
                urls.push(url)
                return Response.json({ data: null })
            },
        })
    }, 60_000)

    afterAll(() => {
        fs.rmSync(tsDir, { recursive: true, force: true })
        fs.rmSync(jsDir, { recursive: true, force: true })
    })

    it('type-checks under the strictest flags, with the expected signatures', () => {
        expect(diagnostics).toEqual([])
    })

    it.each([
        [
            'adds the query string',
            () => client.directory.list({ region: 'north', area: 'harbour' }),
            'http://x/api/directory?region=north&area=harbour',
        ],
        [
            'leaves it off without params',
            () => client.directory.list(),
            'http://x/api/directory',
        ],
        [
            'combines path params, body and query',
            () => client.items.import('7', { rows: [] }, { dryRun: true }),
            'http://x/api/items/7/import?dryRun=true',
        ],
        [
            'keeps routes without a declared query as they were',
            () => client.otp.verify('42'),
            'http://x/api/otp/42',
        ],
    ])('%s', async (_case, call, expected) => {
        await call()
        expect(urls.at(-1)).toBe(expected)
    })
})
