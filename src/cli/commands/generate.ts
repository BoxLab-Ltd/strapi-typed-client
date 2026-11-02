/**
 * Generate command - generates TypeScript types from Strapi schema
 */

import * as fs from 'fs'
import * as path from 'path'
import type { Command } from 'commander'
import { createApiClient } from '../utils/api-client.js'
import {
    readLocalSchemaHash,
    readLocalGeneratorVersion,
    requireOutputDir,
    isInsideNodeModules,
    assertOutputDirForFormat,
} from '../utils/file-writer.js'
import { transformSchema } from '../../core/schema-transformer.js'
import {
    detectOutputFormat,
    hasMixedFormatOutput,
    readValidationMode,
    isSplitTypesOutput,
    validationFileNames,
    type ValidationMode,
} from '../../shared/client-header.js'
import { getGeneratorVersion } from '../../shared/version.js'

export interface GenerateOptions {
    url?: string
    token?: string
    output?: string
    silent?: boolean
    force?: boolean
    format?: 'js' | 'ts'
    typecheck?: boolean
    validation?: ValidationMode
    /** Split types into per-collection files. Defaults to the layout already in --output, else a single file. */
    splitTypes?: boolean
}

const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`

export interface GenerateResult {
    success: boolean
    filesWritten: string[]
    hash?: string
    error?: string
    skipped?: boolean
}

/**
 * Whether committed output can be reused without regenerating. Requires the
 * files to exist AND both the schema hash and the generator version to match —
 * a package upgrade that changes the output format bumps the version, so an
 * unchanged schema still forces a regen (otherwise new emitters never ship).
 */
export function isGeneratedOutputFresh(params: {
    localHash: string | null
    remoteHash: string
    localVersion: string | null
    cliVersion: string
    allFilesExist: boolean
    localValidation?: ValidationMode | null
    validation?: ValidationMode
    localSplitTypes?: boolean
    splitTypes?: boolean
}): boolean {
    const { localHash, remoteHash, localVersion, cliVersion, allFilesExist } =
        params
    if (!localHash || !allFilesExist) return false
    if (localHash !== remoteHash) return false
    if (localVersion !== cliVersion) return false
    if ((params.localValidation ?? 'none') !== (params.validation ?? 'none')) {
        return false
    }
    if (!!params.localSplitTypes !== !!params.splitTypes) return false
    return true
}

/** Files a generation in this format and validation mode leaves in the output dir. */
export function generatedFileNames(
    format: 'js' | 'ts',
    validation: ValidationMode,
    splitTypes = false,
): string[] {
    const base =
        format === 'ts'
            ? ['types.ts', 'client.ts', 'index.ts']
            : [
                  'types.js',
                  'types.d.ts',
                  'client.js',
                  'client.d.ts',
                  'index.js',
                  'index.d.ts',
              ]
    // Per-collection files depend on the schema, so only the fixed ones are listed
    const split = splitTypes
        ? format === 'ts'
            ? ['base.ts']
            : ['base.js', 'base.d.ts']
        : []
    const all = [...base, ...split]
    return validation === 'zod' ? [...all, ...validationFileNames(format)] : all
}

/**
 * Generate types from Strapi API
 */
export async function generate(
    options: GenerateOptions,
): Promise<GenerateResult> {
    const filesWritten: string[] = []

    try {
        const outputDir = requireOutputDir(options.output)
        const format: 'js' | 'ts' =
            options.format ?? detectOutputFormat(outputDir) ?? 'js'
        assertOutputDirForFormat(outputDir, format)
        const localValidation = readValidationMode(outputDir)
        const validation: ValidationMode =
            options.validation ?? localValidation ?? 'none'
        const localSplitTypes = isSplitTypesOutput(outputDir)
        const splitTypes = options.splitTypes ?? localSplitTypes

        if (!options.silent && hasMixedFormatOutput(outputDir)) {
            console.log(
                dim(
                    `Both .ts and .js clients found in ${outputDir} — regenerating as ${format}.\n` +
                        'Delete the other format once nothing imports it.',
                ),
            )
        }

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
            const localVersion = readLocalGeneratorVersion(outputDir)
            const cliVersion = getGeneratorVersion()

            // Verify generated files actually exist (they may be lost after package update)
            const generatedFiles = generatedFileNames(
                format,
                validation,
                splitTypes,
            ).map(f => path.join(outputDir, f))
            const allFilesExist = generatedFiles.every(f => fs.existsSync(f))

            if (localHash && allFilesExist) {
                if (!options.silent) {
                    console.log('Checking schema hash...')
                }

                try {
                    const { hash: remoteHash } = await client.getSchemaHash()

                    if (
                        isGeneratedOutputFresh({
                            localHash,
                            remoteHash,
                            localVersion,
                            cliVersion,
                            allFilesExist,
                            localValidation,
                            validation,
                            localSplitTypes,
                            splitTypes,
                        })
                    ) {
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
                        if (localHash !== remoteHash) {
                            console.log(
                                `Schema changed (${localHash.substring(0, 8)}... -> ${remoteHash.substring(0, 8)}...)`,
                            )
                        } else if (
                            localVersion === cliVersion &&
                            localSplitTypes !== splitTypes
                        ) {
                            console.log(
                                `Types layout changed (${localSplitTypes ? 'split' : 'single file'} -> ${splitTypes ? 'split' : 'single file'}), regenerating...`,
                            )
                        } else if (localVersion === cliVersion) {
                            console.log(
                                `Validation changed (${localValidation ?? 'none'} -> ${validation}), regenerating...`,
                            )
                        } else {
                            console.log(
                                `Generator updated (v${localVersion ?? '?'} -> v${cliVersion}), regenerating...`,
                            )
                        }
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
            authMode,
            hash,
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
            if (authMode === 'refresh') {
                console.log('  Auth mode: refresh (session flow enabled)')
            }
        }

        // Transform JSON schema to ParsedSchema format
        const parsedSchema = transformSchema(schema)

        // Generate types
        if (!options.silent) {
            console.log('Generating TypeScript types...')
        }

        // lazy: keeps the typescript compiler out of init/check/--help startup
        const { Generator } = await import('../../generator/index.js')
        const generator = new Generator(outputDir)
        await generator.generate(parsedSchema, {
            endpoints,
            extraTypes,
            schemaHash: hash,
            generatorVersion: getGeneratorVersion(),
            format,
            typecheck: options.typecheck ?? true,
            authMode: authMode ?? 'legacy',
            validation,
            splitTypes,
        })

        for (const f of generatedFileNames(format, validation, splitTypes)) {
            filesWritten.push(path.join(outputDir, f))
        }

        if (!options.silent && isInsideNodeModules(outputDir)) {
            console.log(
                dim(
                    'Types written into node_modules — a reinstall wipes them.\n' +
                        'For durable, reviewable types, generate into your source tree and commit it:\n' +
                        '  strapi-types generate --output ./src/strapi',
                ),
            )
        }

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
    format?: string
    typecheck?: boolean
    validation?: string
    splitTypes?: boolean
    singleFile?: boolean
}

/**
 * CLI handler for generate command
 */
export function createGenerateCommand(program: Command): void {
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
            'Output directory (required) — your source tree, e.g. ./src/strapi',
        )
        .option('-s, --silent', 'Suppress output messages')
        .option('-f, --force', 'Force regeneration even if schema unchanged')
        .option(
            '--format <js|ts>',
            'Output format: js (compiled .js + .d.ts) or ts (raw .ts for monorepo/source-tree output). Defaults to the format already in --output, else js',
        )
        .option(
            '--no-typecheck',
            'Write the generated client even if it fails type-checking (escape hatch for strict-only false positives)',
        )
        .option(
            '--validation <zod|none>',
            'Also generate Zod validators for create/update inputs (needs zod 4 installed). Defaults to the mode already in --output, else none',
        )
        .option(
            '--split-types',
            'Write one types file per collection and component category (base.ts + collections/) instead of a single types.ts. Defaults to the layout already in --output',
        )
        .option('--single-file', 'Write a single types.ts (undo --split-types)')
        .action(async (opts: GenerateCliOptions) => {
            if (opts.splitTypes && opts.singleFile) {
                console.error(
                    '--split-types and --single-file cannot be used together.',
                )
                process.exit(1)
            }
            if (opts.format && opts.format !== 'js' && opts.format !== 'ts') {
                console.error(
                    `Invalid --format value: ${opts.format}. Expected 'js' or 'ts'.`,
                )
                process.exit(1)
            }
            if (!isValidationMode(opts.validation)) {
                console.error(
                    `Invalid --validation value: ${opts.validation}. Expected 'zod' or 'none'.`,
                )
                process.exit(1)
            }

            const result = await generate({
                url: opts.url,
                token: opts.token,
                output: opts.output,
                silent: opts.silent,
                force: opts.force,
                format: opts.format as 'js' | 'ts' | undefined,
                typecheck: opts.typecheck,
                validation: opts.validation,
                splitTypes: opts.splitTypes
                    ? true
                    : opts.singleFile
                      ? false
                      : undefined,
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

export function isValidationMode(
    value: string | undefined,
): value is ValidationMode | undefined {
    return value === undefined || value === 'zod' || value === 'none'
}
