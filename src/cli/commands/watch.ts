/**
 * Watch command - connects to SSE stream and regenerates types on schema changes
 */

import { createApiClient } from '../utils/api-client.js'
import type { Command } from 'commander'
import { readLocalSchemaHash, requireOutputDir } from '../utils/file-writer.js'
import { SseConnection } from '../../shared/sse-client.js'
import { generate, isValidationMode } from './generate.js'
import type { ValidationMode } from '../../shared/client-header.js'

export interface WatchOptions {
    url?: string
    token?: string
    output?: string
    silent?: boolean
    format?: 'js' | 'ts'
    typecheck?: boolean
    validation?: ValidationMode
    splitTypes?: boolean
}

/**
 * Watch for schema changes via SSE
 */
export async function watch(options: WatchOptions): Promise<void> {
    const outputDir = requireOutputDir(options.output)

    const client = createApiClient({
        url: options.url,
        token: options.token,
    })

    // Check if Strapi is reachable
    const isReachable = await client.ping()
    if (!isReachable) {
        console.error(
            `Cannot connect to Strapi at ${options.url || process.env.STRAPI_URL || 'http://localhost:1337'}`,
        )
        console.error(
            'Make sure the Strapi server is running and the strapi-types plugin is enabled.',
        )
        process.exit(1)
    }

    // Always reconcile once at startup: the SSE path only reacts to a hash
    // change, so a new --format/--validation or a generator upgrade would
    // otherwise never reach an existing tree. Unforced, so a fresh tree is kept.
    if (!readLocalSchemaHash(outputDir)) {
        console.log('No existing types found. Generating initial types...')
    }
    const initial = await generate({
        url: options.url,
        token: options.token,
        output: outputDir,
        silent: options.silent,
        format: options.format,
        typecheck: options.typecheck,
        validation: options.validation,
        splitTypes: options.splitTypes,
    })
    if (!initial.success) {
        console.error('Failed to generate types:', initial.error)
    }

    let lastHash = readLocalSchemaHash(outputDir)
    let generating = false

    console.log('Watching for schema changes (SSE)...')
    console.log('Press Ctrl+C to stop.\n')

    const sse = new SseConnection({
        url: client.sseUrl,
        headers: client.getHeaders(),
        // nothing else holds the CLI's event loop, so an unref'd reconnect timer lets Node exit on a Strapi restart
        keepAlive: true,
        async onEvent({ event, data }) {
            if (event !== 'connected' || generating) return

            try {
                const { hash: remoteHash } = JSON.parse(data)

                if (lastHash !== remoteHash) {
                    generating = true
                    console.log(
                        `Schema change detected (${lastHash?.substring(0, 8) || 'none'} -> ${remoteHash.substring(0, 8)}...)`,
                    )
                    console.log('Regenerating types...')

                    const result = await generate({
                        url: options.url,
                        token: options.token,
                        output: outputDir,
                        silent: true,
                        format: options.format,
                        typecheck: options.typecheck,
                        validation: options.validation,
                        splitTypes: options.splitTypes,
                    })

                    if (result.success) {
                        console.log('Types regenerated successfully.\n')
                        lastHash = remoteHash
                    } else {
                        console.error(
                            'Failed to regenerate types:',
                            result.error,
                        )
                    }
                    generating = false
                }
            } catch {
                generating = false
            }
        },
        onError(err) {
            // Silence connection errors — Strapi may be restarting
            if (!options.silent) {
                const msg = err instanceof Error ? err.message : String(err)
                if (!msg.includes('ECONNREFUSED')) {
                    console.error(`SSE error: ${msg}`)
                }
            }
        },
    })

    sse.connect()

    // Handle graceful shutdown
    const stop = () => {
        console.log('\nStopping watch...')
        sse.close()
        process.exit(0)
    }

    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
}

/**
 * Raw option shape handed over by commander. `format` arrives as a plain
 * string, so it is validated before being narrowed into WatchOptions.
 */
interface WatchCliOptions {
    url?: string
    token?: string
    output?: string
    silent?: boolean
    format?: string
    typecheck?: boolean
    validation?: string
    splitTypes?: boolean
    singleFile?: boolean
}

/**
 * CLI handler for watch command
 */
export function createWatchCommand(program: Command): void {
    program
        .command('watch')
        .description(
            'Watch for schema changes and regenerate types automatically',
        )
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
        .option('-s, --silent', 'Suppress regeneration messages')
        .option(
            '--format <js|ts>',
            'Output format: js (compiled .js + .d.ts) or ts (raw .ts for monorepo/source-tree output). Defaults to the format already in --output, else js',
        )
        .option(
            '--no-typecheck',
            'Write regenerated types even if they fail type-checking (escape hatch for strict-only false positives)',
        )
        .option(
            '--validation <zod|none>',
            'Also generate Zod validators for create/update inputs (needs zod 4 installed). Defaults to the mode already in --output, else none',
        )
        .option(
            '--split-types',
            'Write one types file per collection and component category instead of a single types.ts. Defaults to the layout already in --output',
        )
        .option('--single-file', 'Write a single types.ts (undo --split-types)')
        .action(async (opts: WatchCliOptions) => {
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

            try {
                await watch({
                    url: opts.url,
                    token: opts.token,
                    output: opts.output,
                    silent: opts.silent,
                    format: opts.format as 'js' | 'ts' | undefined,
                    typecheck: opts.typecheck,
                    validation: opts.validation,
                    splitTypes: opts.splitTypes
                        ? true
                        : opts.singleFile
                          ? false
                          : undefined,
                })
            } catch (err) {
                console.error((err as Error).message)
                process.exit(1)
            }
        })
}
