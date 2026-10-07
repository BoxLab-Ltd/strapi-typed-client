import { describe, it, expect } from 'vitest'
import * as ts from 'typescript'
import { parseControllerSource } from '../../../src/plugin/server/src/services/endpoint-parser.js'

const parse = (source: string) => parseControllerSource(ts, source, 'demo')

describe('parseControllerSource', () => {
    it('reads body, response, params and query of each action', () => {
        const { endpoints } = parse(`
            export interface Endpoints {
                create: {
                    body: { email: string }
                    response: { data: { id: number } }
                    params: { id: string }
                    query: { draft?: boolean }
                }
                ping: { response: void }
            }
        `)
        expect(endpoints).toEqual({
            create: {
                body: '{ email: string; }',
                response: '{ data: { id: number; }; }',
                params: '{ id: string; }',
                query: '{ draft?: boolean; }',
            },
            ping: { response: 'void' },
        })
    })

    it('keeps a union that spans several lines whole', () => {
        const { endpoints } = parse(`
            export interface Endpoints {
                status: {
                    response:
                        | { state: 'idle' }
                        | { state: 'busy'; progress: number }
                }
            }
        `)
        expect(endpoints?.status?.response).toBe(
            "{ state: 'idle'; } | { state: 'busy'; progress: number; }",
        )
    })

    it('does not mistake nested keys for actions or fields', () => {
        const { endpoints } = parse(`
            export interface Endpoints {
                search: {
                    response: { body: string; meta: { response: number } }
                }
            }
        `)
        expect(Object.keys(endpoints ?? {})).toEqual(['search'])
        expect(endpoints?.search).toEqual({
            response: '{ body: string; meta: { response: number; }; }',
        })
    })

    it('keeps line breaks inside template literal types', () => {
        const { endpoints, extraTypes } = parse(
            'export type Tag = `line1\n  line2 ${string}`\n' +
                'export interface Endpoints {\n' +
                '    run: {\n' +
                '        response: {\n' +
                '            tag: `a\nb`\n' +
                '        }\n' +
                '    }\n' +
                '}\n',
        )
        expect(endpoints?.run?.response).toBe('{ tag: `a\nb`; }')
        expect(extraTypes[0]?.typeDefinition).toBe('`line1\n  line2 ${string}`')
    })

    it('reports a file that does not parse', () => {
        expect(parse('export interface Endpoints {').syntaxError).toBe(true)
        expect(parse('export interface Endpoints {}').syntaxError).toBe(false)
    })

    it('ignores comments, including ones holding braces and quotes', () => {
        const { endpoints } = parse(`
            export interface Endpoints {
                // don't { parse } this
                run: {
                    /** The } user's id */
                    body: { userId: number /* { */ }
                }
            }
        `)
        expect(endpoints?.run?.body).toBe('{ userId: number; }')
    })

    it('keeps braces inside string literal types', () => {
        const { endpoints } = parse(`
            export interface Endpoints {
                fmt: { response: { pattern: '{x}' | "}" } }
            }
        `)
        expect(endpoints?.fmt?.response).toBe(`{ pattern: '{x}' | "}"; }`)
    })

    it('accepts the type alias form and quoted action names', () => {
        const { endpoints } = parse(`
            export type Endpoints = {
                'do-thing': { body: { a: string } }
            } & { other: { response: number } }
        `)
        expect(endpoints).toEqual({
            'do-thing': { body: '{ a: string; }' },
            other: { response: 'number' },
        })
    })

    it('merges repeated Endpoints declarations', () => {
        const { endpoints } = parse(`
            export interface Endpoints { a: { response: string } }
            export interface Endpoints { b: { response: number } }
        `)
        expect(Object.keys(endpoints ?? {})).toEqual(['a', 'b'])
    })

    it('replaces types that cannot resolve on the client with unknown', () => {
        const { endpoints } = parse(`
            const svc = { find: async () => 1 }
            export interface Endpoints {
                list: { response: Awaited<ReturnType<typeof svc.find>> }
                load: { response: import('./x').Thing }
                partial: { response: { ok: boolean; data: Partial<ReturnType<typeof svc.find>> } }
            }
        `)
        expect(endpoints?.list?.response).toBe('unknown')
        expect(endpoints?.load?.response).toBe('unknown')
        expect(endpoints?.partial?.response).toBe(
            '{ ok: boolean; data: unknown; }',
        )
    })

    it('needs the export, as before', () => {
        expect(
            parse('interface Endpoints { a: { response: string } }').endpoints,
        ).toBeNull()
    })

    it('collects other exported types, flattened to one line', () => {
        const { extraTypes } = parse(`
            export type SSEEvent =
                | { type: 'connected' }
                | { type: 'progress'; value: number }
            export interface SearchHit {
                id: number
                // score from the engine
                score: number
            }
            export interface Endpoints { a: { response: SearchHit } }
        `)
        expect(extraTypes).toEqual([
            {
                controller: 'demo',
                typeName: 'SSEEvent',
                typeDefinition:
                    "{ type: 'connected'; } | { type: 'progress'; value: number; }",
            },
            {
                controller: 'demo',
                typeName: 'SearchHit',
                typeDefinition: '{ id: number; score: number; }',
            },
        ])
    })

    it('carries interface bases as an intersection and skips generic types', () => {
        const { extraTypes } = parse(`
            export interface Base { id: number }
            export interface Item extends Base { name: string }
            export type Page<T> = { items: T[] }
            export interface Box<T> { value: T }
        `)
        expect(extraTypes.map(t => [t.typeName, t.typeDefinition])).toEqual([
            ['Base', '{ id: number; }'],
            ['Item', 'Base & { name: string; }'],
        ])
    })

    it('gives up on a file that does not parse instead of emitting garbage', () => {
        expect(
            parse('export interface Endpoints { a: { response: { x: } }'),
        ).toEqual({ endpoints: null, extraTypes: [], syntaxError: true })
    })
})
