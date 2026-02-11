import { describe, it, expect } from 'vitest'
import {
    computeSchemaHash,
    schemasMatch,
    shortHash,
    generateSchemaMetadata,
} from '../../../src/shared/schema-hash'

describe('schema-hash', () => {
    describe('computeSchemaHash', () => {
        it('computes consistent hash for same input', () => {
            const schema = { name: 'test', attributes: { title: 'string' } }
            const hash1 = computeSchemaHash(schema)
            const hash2 = computeSchemaHash(schema)
            expect(hash1).toBe(hash2)
        })

        it('computes different hash for different input', () => {
            const schema1 = { name: 'test1' }
            const schema2 = { name: 'test2' }
            expect(computeSchemaHash(schema1)).not.toBe(
                computeSchemaHash(schema2),
            )
        })

        it('normalizes object key order', () => {
            const schema1 = { b: 1, a: 2 }
            const schema2 = { a: 2, b: 1 }
            expect(computeSchemaHash(schema1)).toBe(computeSchemaHash(schema2))
        })

        it('handles nested objects', () => {
            const schema = {
                name: 'test',
                nested: { a: 1, b: { c: 2 } },
            }
            const hash = computeSchemaHash(schema)
            expect(hash).toHaveLength(64) // SHA256 hex length
        })

        it('handles arrays', () => {
            const schema = { items: [1, 2, 3] }
            const hash = computeSchemaHash(schema)
            expect(hash).toHaveLength(64)
        })
    })

    describe('schemasMatch', () => {
        it('returns true for matching hashes', () => {
            const hash = 'abc123'
            expect(schemasMatch(hash, hash)).toBe(true)
        })

        it('returns false for different hashes', () => {
            expect(schemasMatch('abc123', 'def456')).toBe(false)
        })
    })

    describe('shortHash', () => {
        it('returns first 8 characters of hash', () => {
            const fullHash = 'abcdef1234567890'
            expect(shortHash(fullHash)).toBe('abcdef12')
        })
    })

    describe('generateSchemaMetadata', () => {
        it('generates metadata with hash and timestamp', () => {
            const schema = { name: 'test' }
            const version = '1.0.0'
            const metadata = generateSchemaMetadata(schema, version)

            expect(metadata.hash).toHaveLength(64)
            expect(metadata.shortHash).toHaveLength(8)
            expect(metadata.version).toBe(version)
            expect(metadata.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        })
    })
})
