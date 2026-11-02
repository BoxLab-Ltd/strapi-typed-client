import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { jsonSchemaToTs } from '../../../src/shared/json-schema-to-ts.js'

const out = (schema: z.ZodType) =>
    jsonSchemaToTs(
        schema.toJSONSchema({ io: 'output', unrepresentable: 'any' }),
    )
const input = (schema: z.ZodType) =>
    jsonSchemaToTs(schema.toJSONSchema({ io: 'input', unrepresentable: 'any' }))

describe('jsonSchemaToTs', () => {
    it('maps primitives, literals and enums', () => {
        expect(out(z.string())).toBe('string')
        expect(out(z.number().int())).toBe('number')
        expect(out(z.boolean())).toBe('boolean')
        expect(out(z.null())).toBe('null')
        expect(out(z.literal('a'))).toBe('"a"')
        expect(out(z.enum(['a', 'b']))).toBe('"a" | "b"')
    })

    it('maps objects with required and optional keys', () => {
        expect(
            out(
                z.object({
                    id: z.number(),
                    name: z.string().nullable(),
                    'x-key': z.string().optional(),
                }),
            ),
        ).toBe('{ id: number; name: string | null; "x-key"?: string }')
    })

    it('maps records, arrays and unions of objects', () => {
        expect(out(z.record(z.string(), z.unknown()))).toBe(
            'Record<string, unknown>',
        )
        expect(out(z.array(z.union([z.string(), z.number()])))).toBe(
            '(string | number)[]',
        )
        expect(out(z.tuple([z.string(), z.number()]))).toBe('[string, number]')
        expect(
            out(
                z.union([
                    z.object({ kind: z.literal('a') }),
                    z.object({ kind: z.literal('b') }),
                ]),
            ),
        ).toBe('{ kind: "a" } | { kind: "b" }')
    })

    it('treats a default as optional on input and required on output', () => {
        const schema = z.object({ a: z.string().default('x') })
        expect(input(schema)).toBe('{ a?: string }')
        expect(out(schema)).toBe('{ a: string }')
    })

    it('falls back to unknown for what JSON Schema cannot express', () => {
        expect(out(z.object({ d: z.date() }))).toBe('{ d: unknown }')
        expect(out(z.any())).toBe('unknown')
        expect(out(z.union([z.string(), z.any()]))).toBe('unknown')
    })

    it('inlines $defs and stops at a recursive reference', () => {
        const Node: z.ZodType = z.object({
            name: z.string(),
            get children() {
                return z.array(Node)
            },
        })
        expect(out(Node)).toBe('{ name: string; children: unknown[] }')
        expect(
            jsonSchemaToTs({
                $defs: { Id: { type: 'string' } },
                type: 'object',
                properties: { id: { $ref: '#/$defs/Id' } },
                required: ['id'],
            }),
        ).toBe('{ id: string }')
    })

    it('keeps an empty strict object closed and an open one open', () => {
        expect(out(z.object({}))).toBe('Record<string, never>')
        expect(out(z.looseObject({ a: z.string() }))).toBe(
            '{ a: string; [key: string]: unknown }',
        )
    })

    it('degrades garbage to unknown instead of throwing', () => {
        expect(jsonSchemaToTs(undefined)).toBe('unknown')
        expect(jsonSchemaToTs({ $ref: 'http://elsewhere' })).toBe('unknown')
        expect(jsonSchemaToTs(false)).toBe('never')
    })
})
