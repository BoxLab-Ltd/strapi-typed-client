/**
 * Next.js plugin for automatic Strapi type generation.
 *
 * Usage in next.config.ts:
 *
 *   import { withStrapiTypes } from 'strapi-typed-client/next'
 *   export default withStrapiTypes()(nextConfig)
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import { createRequire } from 'module'
import * as path from 'path'

export interface StrapiTypesConfig {
    strapiUrl?: string
    token?: string
    watchInterval?: number
    silent?: boolean
}

const _require = createRequire(import.meta.url)

function getPackageDir(): string {
    const pkgJsonPath = _require.resolve('strapi-typed-client/package.json')
    return path.dirname(pkgJsonPath)
}

function getOutputDir(): string {
    return path.join(getPackageDir(), 'dist')
}

function getCacheDir(): string {
    const packageDir = getPackageDir()
    const nodeModules = path.dirname(path.dirname(packageDir))
    return path.join(nodeModules, '.cache', 'strapi-types')
}

function readCachedHash(): string | null {
    try {
        const hashFile = path.join(getCacheDir(), 'schema-hash')
        return fs.readFileSync(hashFile, 'utf-8').trim()
    } catch {
        return null
    }
}

function writeCachedHash(hash: string): void {
    try {
        const cacheDir = getCacheDir()
        fs.mkdirSync(cacheDir, { recursive: true })
        fs.writeFileSync(path.join(cacheDir, 'schema-hash'), hash, 'utf-8')
    } catch {
        // Non-critical
    }
}

// ANSI colors matching Next.js output
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

function info(silent: boolean, msg: string): void {
    if (!silent) console.log(`${green('○')} ${msg}`)
}

function ok(silent: boolean, msg: string): void {
    if (!silent) console.log(`${green('✓')} ${msg}`)
}

function fail(msg: string): void {
    console.error(`${red('⨯')} ${msg}`)
}

function loading(silent: boolean, msg: string): () => void {
    if (silent) return () => {}
    const frames = ['·  ', '·· ', '···', ' ··', '  ·', '   ']
    let i = 0
    process.stdout.write(`${green('○')} ${msg} ${frames[0]}`)
    const id = setInterval(() => {
        i = (i + 1) % frames.length
        process.stdout.write(`\r${green('○')} ${msg} ${frames[i]}`)
    }, 150)
    return () => {
        clearInterval(id)
        process.stdout.write(`\r\x1b[K`)
    }
}

async function startDevWatch(config: StrapiTypesConfig): Promise<void> {
    const outputDir = getOutputDir()
    const interval = config.watchInterval ?? 5000
    const silent = config.silent ?? false
    const url =
        config.strapiUrl || process.env.STRAPI_URL || 'http://localhost:1337'
    const token = config.token || process.env.STRAPI_TOKEN

    const { createApiClient } = await import('../cli/utils/api-client.js')
    const { generate } = await import('../cli/commands/generate.js')

    const client = createApiClient({ url, token })

    let lastHash = readCachedHash()

    info(
        silent,
        `Watching for schema changes ${dim(`(every ${interval / 1000}s)`)}`,
    )

    const poll = async () => {
        try {
            const { hash: remoteHash } = await client.getSchemaHash()

            if (lastHash !== remoteHash) {
                const stop = loading(silent, 'Regenerating types')

                const start = Date.now()
                const result = await generate({
                    url,
                    token,
                    output: outputDir,
                    silent: true,
                    force: true,
                })

                stop()

                if (result.success) {
                    ok(
                        silent,
                        `Types regenerated in ${dim(`${Date.now() - start}ms`)}`,
                    )
                    lastHash = remoteHash
                    writeCachedHash(remoteHash)
                } else {
                    fail(`Failed to regenerate: ${result.error}`)
                }
            }
        } catch {
            // Strapi not available yet
        }
    }

    await poll()

    const intervalId = setInterval(poll, interval)
    // unref() prevents the timer from keeping detached/worker processes alive
    intervalId.unref()

    const cleanup = () => {
        clearInterval(intervalId)
        releaseWatchLock()
    }
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
    process.on('exit', cleanup)
}

function runBuildGenerate(config: StrapiTypesConfig): void {
    const silent = config.silent ?? false
    const url =
        config.strapiUrl || process.env.STRAPI_URL || 'http://localhost:1337'
    const token = config.token || process.env.STRAPI_TOKEN
    const outputDir = getOutputDir()
    const binPath = path.join(getPackageDir(), 'dist', 'cli', 'index.js')

    const args = [
        'node',
        JSON.stringify(binPath),
        'generate',
        '--force',
        '--silent',
        '--output',
        JSON.stringify(outputDir),
        '--url',
        JSON.stringify(url),
    ]

    if (token) {
        args.push('--token', JSON.stringify(token))
    }

    try {
        const stop = loading(silent, 'Generating types')
        const start = Date.now()
        execSync(args.join(' '), { stdio: 'ignore' })
        stop()
        ok(silent, `Types generated in ${dim(`${Date.now() - start}ms`)}`)
    } catch {
        fail('Failed to generate types, using existing if available')
    }
}

/**
 * Acquire a PID-based file lock so only one process runs the polling loop.
 * Next.js dev spawns multiple worker processes — each would start its own watcher.
 */
function acquireWatchLock(): boolean {
    const lockFile = path.join(getCacheDir(), 'watch.lock')
    try {
        // Check existing lock
        const existing = fs.readFileSync(lockFile, 'utf-8').trim()
        const pid = Number(existing)
        if (pid && pid !== process.pid) {
            try {
                process.kill(pid, 0) // throws if process is dead
                return false // another process owns the lock
            } catch {
                // stale lock, take over
            }
        }
    } catch {
        // no lock file
    }
    try {
        fs.mkdirSync(getCacheDir(), { recursive: true })
        fs.writeFileSync(lockFile, String(process.pid), 'utf-8')
        return true
    } catch {
        return false
    }
}

function releaseWatchLock(): void {
    try {
        const lockFile = path.join(getCacheDir(), 'watch.lock')
        const existing = fs.readFileSync(lockFile, 'utf-8').trim()
        if (Number(existing) === process.pid) {
            fs.unlinkSync(lockFile)
        }
    } catch {
        // ignore
    }
}

// Detached telemetry/worker processes should never start the watcher
function isMainNextProcess(): boolean {
    return !process.argv.some(
        arg =>
            arg.includes('detached-flush') ||
            arg.includes('next-telemetry') ||
            arg.includes('/worker'),
    )
}

export function withStrapiTypes(config?: StrapiTypesConfig) {
    return <T>(nextConfig: T): T => {
        const cfg = config ?? {}

        if (process.env.NODE_ENV === 'development' && isMainNextProcess()) {
            // next dev — polling loop (only one process via PID lock)
            if (acquireWatchLock()) {
                startDevWatch(cfg)
            }
        } else if (process.argv.includes('build')) {
            // next build — one-time sync generation
            runBuildGenerate(cfg)
        }
        // next start — do nothing, types already generated during build

        return nextConfig
    }
}
