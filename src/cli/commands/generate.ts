/**
 * Generate command - generates TypeScript types from Strapi schema
 */

import * as fs from 'fs'
import * as path from 'path'
import { createApiClient } from '../utils/api-client.js'
import {
    writeFile,
    getSchemaMetaPath,
    generateSchemaMetaContent,
    readLocalSchemaHash,
    getDefaultOutputDir,
} from '../utils/file-writer.js'
import { Generator } from '../../generator/index.js'
import { transformSchema } from '../../core/schema-transformer.js'

export interface GenerateOptions {
    url?: string
    token?: string
    output?: string
    silent?: boolean
    force?: boolean
}

export interface GenerateResult {
    success: boolean
    filesWritten: string[]
    hash?: string
    error?: string
    skipped?: boolean
}

/**
 * Generate types from Strapi API
 */
export async function generate(
    options: GenerateOptions,
): Promise<GenerateResult> {
    const outputDir = options.output || getDefaultOutputDir()
    const filesWritten: string[] = []

    try {
        // Create API client
        const client = createApiClient({
            url: options.url,
            token: options.token,
        })

        const baseUrl =
            options.url || process.env.STRAPI_URL || 'http://localhost:1337'

        // Check if we need to regenerate (compare hashes)
        if (!options.force) {
            const localHash = readLocalSchemaHash(outputDir)

            // Verify generated files actually exist (they may be lost after package update)
            const generatedFiles = [
                'types.d.ts',
                'client.d.ts',
                'index.d.ts',
            ].map(f => path.join(outputDir, f))
            const allFilesExist = generatedFiles.every(f => fs.existsSync(f))

            if (localHash && allFilesExist) {
                if (!options.silent) {
                    console.log('Checking schema hash...')
                }

                try {
                    const { hash: remoteHash } = await client.getSchemaHash()

                    if (localHash === remoteHash) {
                        if (!options.silent) {
                            console.log(
                                `Types are up to date (hash: ${localHash.substring(0, 8)}...)`,
                            )
                        }
                        return {
                            success: true,
                            filesWritten: [],
                            hash: localHash,
                            skipped: true,
                        }
                    }

                    if (!options.silent) {
                        console.log(
                            `Schema changed (${localHash.substring(0, 8)}... -> ${remoteHash.substring(0, 8)}...)`,
                        )
                    }
                } catch {
                    // If hash check fails, continue with full generation
                    if (!options.silent) {
                        console.log(
                            'Could not check remote hash, regenerating...',
                        )
                    }
                }
            } else if (localHash && !allFilesExist) {
                if (!options.silent) {
                    console.log(
                        'Generated files missing (package may have been updated), regenerating...',
                    )
                }
            }
        }

        // Fetch schema from Strapi
        if (!options.silent) {
            console.log(`Fetching schema from ${baseUrl}...`)
        }

        const {
            schema,
            endpoints: apiEndpoints,
            pluginEndpoints,
            extraTypes,
            hash,
            generatedAt,
        } = await client.getSchema()

        // Merge API and plugin endpoints for generation
        const endpoints = [...(apiEndpoints || []), ...(pluginEndpoints || [])]

        if (!options.silent) {
            console.log(
                `  Content types: ${Object.keys(schema.contentTypes).length}`,
            )
            console.log(
                `  Components: ${Object.keys(schema.components).length}`,
            )
            if (endpoints && endpoints.length > 0) {
                console.log(`  Custom endpoints: ${endpoints.length}`)
            }
            if (extraTypes && extraTypes.length > 0) {
                console.log(`  Extra types: ${extraTypes.length}`)
            }
        }

        // Transform JSON schema to ParsedSchema format
        const parsedSchema = transformSchema(schema)

        // Generate types
        if (!options.silent) {
            console.log('Generating TypeScript types...')
        }

        const generator = new Generator(outputDir)
        await generator.generate(parsedSchema, endpoints, extraTypes)

        // Track generated files
        filesWritten.push(
            path.join(outputDir, 'types.js'),
            path.join(outputDir, 'types.d.ts'),
            path.join(outputDir, 'client.js'),
            path.join(outputDir, 'client.d.ts'),
            path.join(outputDir, 'index.js'),
            path.join(outputDir, 'index.d.ts'),
        )

        // Write schema metadata
        const metaPath = getSchemaMetaPath(outputDir)
        writeFile(metaPath, generateSchemaMetaContent(hash, generatedAt))
        filesWritten.push(metaPath)

        return {
            success: true,
            filesWritten,
            hash,
        }
    } catch (error) {
        return {
            success: false,
            filesWritten,
            error: (error as Error).message,
        }
    }
}

interface GenerateCliOptions {
    url?: string
    token?: string
    output?: string
    silent?: boolean
    force?: boolean
}

/**
 * CLI handler for generate command
 */
export function createGenerateCommand(program: {
    command: (...args: any[]) => any
}): void {
    program
        .command('generate')
        .description('Generate TypeScript types from Strapi schema')
        .option(
            '-u, --url <url>',
            'Strapi API URL (default: STRAPI_URL env or http://localhost:1337)',
        )
        .option(
            '-t, --token <token>',
            'Strapi API token (default: STRAPI_TOKEN env)',
        )
        .option(
            '-o, --output <path>',
            'Output directory (default: node_modules/strapi-typed-client/dist)',
        )
        .option('-s, --silent', 'Suppress output messages')
        .option('-f, --force', 'Force regeneration even if schema unchanged')
        .action(async (opts: GenerateCliOptions) => {
            const result = await generate({
                url: opts.url,
                token: opts.token,
                output: opts.output,
                silent: opts.silent,
                force: opts.force,
            })

            if (!result.success) {
                console.error('Generation failed:', result.error)
                process.exit(1)
            }

            if (!opts.silent && !result.skipped) {
                console.log('Generation complete!')
                if (result.hash) {
                    console.log(
                        `Schema hash: ${result.hash.substring(0, 8)}...`,
                    )
                }
            }
        })
}
