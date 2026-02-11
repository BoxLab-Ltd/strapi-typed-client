/**
 * Watch command - polls for schema changes and regenerates types
 */

import { createApiClient } from '../utils/api-client.js'
import { readLocalSchemaHash } from '../utils/file-writer.js'
import { generate } from './generate.js'

export interface WatchOptions {
    url?: string
    token?: string
    output?: string
    interval?: number
    silent?: boolean
}

/**
 * Watch for schema changes
 */
export async function watch(options: WatchOptions): Promise<void> {
    const outputDir = options.output || './dist'
    const interval = options.interval || 5000

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

    console.log(
        `Watching for schema changes (polling every ${interval / 1000}s)...`,
    )
    console.log('Press Ctrl+C to stop.\n')

    // Initial generation
    const initialHash = readLocalSchemaHash(outputDir)
    if (!initialHash) {
        console.log('No existing types found. Generating initial types...')
        await generate({
            url: options.url,
            token: options.token,
            output: outputDir,
            silent: options.silent,
        })
    }

    let lastHash = readLocalSchemaHash(outputDir)

    // Start polling
    const poll = async () => {
        try {
            const { hash: remoteHash } = await client.getSchemaHash()

            if (lastHash !== remoteHash) {
                console.log(
                    `Schema change detected (${lastHash?.substring(0, 8) || 'none'} -> ${remoteHash.substring(0, 8)}...)`,
                )
                console.log('Regenerating types...')

                const result = await generate({
                    url: options.url,
                    token: options.token,
                    output: outputDir,
                    silent: true,
                })

                if (result.success) {
                    console.log('Types regenerated successfully.\n')
                    lastHash = remoteHash
                } else {
                    console.error('Failed to regenerate types:', result.error)
                }
            }
        } catch {
            // Silently ignore connection errors during polling
            // The server might be restarting
        }
    }

    // Poll with recursive setTimeout to avoid overlapping calls
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let stopping = false

    const schedulePoll = () => {
        if (stopping) return
        timeoutId = setTimeout(async () => {
            await poll()
            schedulePoll()
        }, interval)
    }

    await poll()
    schedulePoll()

    // Handle graceful shutdown
    const stop = () => {
        stopping = true
        if (timeoutId) clearTimeout(timeoutId)
        process.exit(0)
    }

    process.on('SIGINT', () => {
        console.log('\nStopping watch...')
        stop()
    })

    process.on('SIGTERM', stop)
}

/**
 * CLI handler for watch command
 */
export function createWatchCommand(program: {
    command: (...args: any[]) => any
}): void {
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
            'Output directory (default: ./strapi-types)',
        )
        .option(
            '-i, --interval <ms>',
            'Polling interval in milliseconds (default: 5000)',
            parseInt,
        )
        .option('-s, --silent', 'Suppress regeneration messages')
        .action(async (opts: WatchOptions) => {
            await watch({
                url: opts.url,
                token: opts.token,
                output: opts.output,
                interval: opts.interval,
                silent: opts.silent,
            })
        })
}
