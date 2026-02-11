/**
 * Schema hashing utilities for Strapi Types Generator
 * Used for detecting schema changes and cache invalidation
 * @module shared/schema-hash
 */

import * as crypto from 'crypto'

/**
 * Normalize and sort object keys recursively for deterministic serialization
 */
function normalizeObject(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return obj
    }

    if (Array.isArray(obj)) {
        return obj.map(normalizeObject)
    }

    if (typeof obj === 'object') {
        const sorted: Record<string, unknown> = {}
        const keys = Object.keys(obj as Record<string, unknown>).sort()
        for (const key of keys) {
            sorted[key] = normalizeObject((obj as Record<string, unknown>)[key])
        }
        return sorted
    }

    return obj
}

/**
 * Compute SHA256 hash of a schema object
 * The schema is normalized (sorted keys) before hashing for deterministic results
 * @param schema Any JSON-serializable schema object
 * @returns Hex-encoded SHA256 hash
 */
export function computeSchemaHash(schema: unknown): string {
    const normalized = normalizeObject(schema)
    const json = JSON.stringify(normalized)
    return crypto.createHash('sha256').update(json).digest('hex')
}

/**
 * Compare two schema hashes
 * @returns true if schemas are identical
 */
export function schemasMatch(hash1: string, hash2: string): boolean {
    return hash1 === hash2
}

/**
 * Generate a short hash (first 8 characters) for display purposes
 * @param hash Full SHA256 hash
 * @returns Short hash suitable for display
 */
export function shortHash(hash: string): string {
    return hash.substring(0, 8)
}

/**
 * Create schema metadata object for inclusion in generated code
 */
export interface SchemaMetadata {
    hash: string
    shortHash: string
    generatedAt: string
    version: string
}

/**
 * Generate schema metadata from a schema object
 * @param schema The parsed schema
 * @param version Package version
 */
export function generateSchemaMetadata(
    schema: unknown,
    version: string,
): SchemaMetadata {
    const hash = computeSchemaHash(schema)
    return {
        hash,
        shortHash: shortHash(hash),
        generatedAt: new Date().toISOString(),
        version,
    }
}
