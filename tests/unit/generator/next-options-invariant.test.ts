import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Generator } from '../../../src/generator/index.js'
import type { ParsedEndpoint } from '../../../src/shared/endpoint-types.js'
import { mockSchema } from './fixtures/mock-schema.js'

/**
 * Structural invariant: every generated method that goes through
 * `this.request` must accept `nextOptions`. Three generators assemble method
 * signatures independently (custom routes, auth, plugin registry), so the
 * parameter drifted out of one of them unnoticed — issue #89. Asserting it
 * against the emitted client catches the next drift regardless of which
 * generator introduces it.
 *
 * Methods that never call `this.request` are out of scope by construction:
 * `clearToken` touches local state only, `refresh` delegates to the internal
 * single-flight, and `validateSchema` deliberately uses a bare `fetch` so the
 * schema-hash probe is neither cached nor sent with the session Bearer.
 */

// Custom routes covering every emitted shape: GET bare, GET with a path
// param, POST with a body, and DELETE.
const endpoints: ParsedEndpoint[] = [
    {
        method: 'GET',
        path: '/items/years',
        handler: 'api::item.item.years',
        controller: 'item',
        action: 'years',
    },
    {
        method: 'GET',
        path: '/items/:id/summary',
        handler: 'api::item.item.summary',
        controller: 'item',
        action: 'summary',
    },
    {
        method: 'POST',
        path: '/items/:id/increment-run',
        handler: 'api::item.item.incrementRun',
        controller: 'item',
        action: 'incrementRun',
    },
    {
        method: 'DELETE',
        path: '/items/:id/purge',
        handler: 'api::item.item.purge',
        controller: 'item',
        action: 'purge',
    },
    // A standalone controller with no matching content type.
    {
        method: 'GET',
        path: '/reports/summary',
        handler: 'api::report.report.summary',
        controller: 'report',
        action: 'summary',
    },
]

interface Method {
    name: string
    signature: string
    body: string
}

/** Split the emitted client into top-level `async` methods with their bodies. */
function parseMethods(source: string): Method[] {
    const lines = source.split('\n')
    const methods: Method[] = []

    for (let i = 0; i < lines.length; i++) {
        const start = /^ {2}async (\w+)\(/.exec(lines[i]!)
        if (!start) continue

        // The signature may wrap across lines up to the return type.
        let signature = lines[i]!
        let j = i
        while (!signature.includes('): Promise') && j - i < 15) {
            j++
            signature += ' ' + (lines[j] ?? '').trim()
        }

        // Body runs to the closing brace at method indentation.
        const body: string[] = []
        for (let k = j + 1; k < lines.length; k++) {
            if (/^ {2}}/.test(lines[k]!)) break
            body.push(lines[k]!)
        }

        methods.push({
            name: start[1]!,
            signature,
            body: body.join('\n'),
        })
    }

    return methods
}

// Refresh mode emits the session methods (logout, refresh) that legacy mode
// leaves out, so both are generated and checked.
describe.each(['legacy', 'refresh'] as const)(
    'every generated method that issues a request accepts nextOptions (%s auth)',
    authMode => {
        let tmpDir: string
        let methods: Method[]

        beforeAll(async () => {
            tmpDir = fs.mkdtempSync(
                path.join(os.tmpdir(), 'strapi-types-next-'),
            )
            await new Generator(tmpDir).generate(
                mockSchema,
                endpoints,
                undefined,
                '',
                '',
                'ts',
                true,
                authMode,
            )
            methods = parseMethods(
                fs.readFileSync(path.join(tmpDir, 'client.ts'), 'utf-8'),
            )
        })

        afterAll(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        })

        it('parses a meaningful number of methods out of the client', () => {
            expect(methods.length).toBeGreaterThan(20)
        })

        it('accepts nextOptions wherever this.request is called', () => {
            const offenders = methods
                .filter(m => m.body.includes('this.request'))
                .filter(m => !m.signature.includes('nextOptions'))
                .map(m => m.name)

            expect(offenders).toEqual([])
        })

        it('forwards nextOptions into the request call, not just into the signature', () => {
            const swallowed = methods
                .filter(
                    m =>
                        m.signature.includes('nextOptions') &&
                        m.body.includes('this.request'),
                )
                // The third argument of request(url, init, nextOptions, prefix) is
                // the only slot Next.js options are read from — a method taking the
                // parameter and dropping it is worse than not taking it at all.
                .filter(m => !/this\.request[\s\S]*?nextOptions/.test(m.body))
                .map(m => m.name)

            expect(swallowed).toEqual([])
        })
    },
)
