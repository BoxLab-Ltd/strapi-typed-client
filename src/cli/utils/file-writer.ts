/**
 * File writer utilities for CLI output
 */

import * as fs from 'fs'
import { createRequire } from 'module'
import * as path from 'path'

export interface WriteResult {
    path: string
    success: boolean
    error?: Error
}

/**
 * Ensure directory exists
 */
export function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
    }
}

/**
 * Write content to a file
 */
export function writeFile(filePath: string, content: string): WriteResult {
    try {
        ensureDir(path.dirname(filePath))
        // codeql[js/http-to-file-access] - Generated TypeScript code from parsed Strapi schema, not raw network data
        fs.writeFileSync(filePath, content, 'utf-8')
        return { path: filePath, success: true }
    } catch (error) {
        return { path: filePath, success: false, error: error as Error }
    }
}

/**
 * Read content from a file
 */
export function readFile(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, 'utf-8')
    } catch {
        return null
    }
}

/**
 * Check if file exists
 */
export function fileExists(filePath: string): boolean {
    return fs.existsSync(filePath)
}

/**
 * Write multiple files. Reports all results even if some fail.
 */
export function writeFiles(
    files: Array<{ path: string; content: string }>,
): WriteResult[] {
    const results: WriteResult[] = []

    for (const file of files) {
        const result = writeFile(file.path, file.content)
        results.push(result)

        if (!result.success) {
            console.error(
                `Failed to write ${file.path}:`,
                result.error?.message,
            )
        }
    }

    return results
}

/**
 * Get the schema metadata file path
 */
export function getSchemaMetaPath(outputDir: string): string {
    return path.join(outputDir, 'schema-meta.ts')
}

/**
 * Generate schema metadata file content
 */
export function generateSchemaMetaContent(
    hash: string,
    generatedAt: string,
): string {
    return `/**
 * Schema metadata - auto-generated, do not edit
 * Generated at: ${generatedAt}
 */

export const SCHEMA_HASH = '${hash}'
export const GENERATED_AT = '${generatedAt}'
`
}

/**
 * Resolve default output directory: package dist/ in node_modules.
 * Falls back to ./dist when the package can't be resolved (e.g. local dev).
 */
export function getDefaultOutputDir(): string {
    try {
        const _require = createRequire(
            path.resolve(process.cwd(), 'package.json'),
        )
        const pkgJsonPath = _require.resolve('strapi-typed-client/package.json')
        return path.join(path.dirname(pkgJsonPath), 'dist')
    } catch {
        return './dist'
    }
}

/**
 * Read schema hash from existing schema-meta.ts
 */
export function readLocalSchemaHash(outputDir: string): string | null {
    const metaPath = getSchemaMetaPath(outputDir)
    const content = readFile(metaPath)

    if (!content) {
        return null
    }

    const match = content.match(/SCHEMA_HASH\s*=\s*['"]([^'"]+)['"]/)
    return match ? match[1] : null
}
