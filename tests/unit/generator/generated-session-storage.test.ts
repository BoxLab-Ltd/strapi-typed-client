import {
    describe,
    it,
    expect,
    beforeAll,
    afterAll,
    afterEach,
    vi,
} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { Generator } from '../../../src/generator/index.js'
import { mockSchema } from './fixtures/mock-schema.js'

/**
 * Pluggable refresh-token storage (`tokenStorage`) and the `onTokenRefreshed` /
 * `onSessionExpired` hooks of the refresh-mode session flow, exercised against
 * a real generated client. Most tests deliberately run WITHOUT a `window`
 * global: providing a tokenStorage is what opts a client into the session flow
 * outside a browser (the React Native / Hermes-without-window case).
 */

interface Captured {
    url: string
    init: RequestInit
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

const unauthorized = () =>
    json(
        { error: { status: 401, name: 'UnauthorizedError', message: 'no' } },
        401,
    )
const forbidden = () =>
    json({ error: { status: 403, name: 'ForbiddenError', message: 'no' } }, 403)

function authHeader(init: RequestInit): string | undefined {
    const h = init.headers as Record<string, string> | undefined
    const key =
        h && Object.keys(h).find(k => k.toLowerCase() === 'authorization')
    return key && h ? h[key] : undefined
}

function bodyOf(init: RequestInit): unknown {
    return init.body ? JSON.parse(String(init.body)) : undefined
}

function fakeBackend(opts: {
    validTokens?: string[]
    refresh?: (init: RequestInit) => Response | Promise<Response>
    login?: () => Response
}) {
    const calls: Captured[] = []
    const valid = new Set(opts.validTokens ?? [])
    const fn = async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url)
        const i = init ?? {}
        calls.push({ url: u, init: i })
        if (u.endsWith('/api/auth/refresh')) {
            return opts.refresh ? opts.refresh(i) : unauthorized()
        }
        if (u.endsWith('/api/auth/local')) {
            return opts.login ? opts.login() : unauthorized()
        }
        if (u.endsWith('/api/auth/logout')) return json({ ok: true })
        const bearer = authHeader(i)
        if (!bearer) return forbidden()
        return valid.has(bearer.replace('Bearer ', ''))
            ? json({ data: [] })
            : unauthorized()
    }
    return {
        fetch: fn as unknown as typeof fetch,
        calls,
        refreshCalls: () =>
            calls.filter(c => c.url.endsWith('/api/auth/refresh')),
        logoutCalls: () =>
            calls.filter(c => c.url.endsWith('/api/auth/logout')),
    }
}

/** In-memory tokenStorage with a call log; every method can be made slow or failing. */
function memoryStorage(
    initial?: string,
    opts: { getDelay?: number; setDelay?: number } = {},
) {
    let value: string | undefined = initial
    const log: string[] = []
    const failing = { get: false }
    return {
        value: () => value,
        log,
        failing,
        storage: {
            async getRefreshToken() {
                log.push('get')
                if (opts.getDelay)
                    await new Promise(r => setTimeout(r, opts.getDelay))
                if (failing.get) throw new Error('biometric cancelled')
                return value
            },
            async setRefreshToken(token: string) {
                log.push('set:' + token)
                if (opts.setDelay)
                    await new Promise(r => setTimeout(r, opts.setDelay))
                value = token
            },
            async clearRefreshToken() {
                log.push('clear')
                value = undefined
            },
        },
    }
}

describe('generated client: tokenStorage + session hooks', () => {
    let refreshDir: string
    let legacyDir: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let RefreshClient: new (config: any) => any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let LegacyClient: new (config: any) => any

    beforeAll(async () => {
        refreshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-types-ss-'))
        legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-types-sg-'))
        await new Generator(refreshDir).generate(mockSchema, {
            endpoints: [],
            format: 'js',
            typecheck: true,
            authMode: 'refresh',
        })
        await new Generator(legacyDir).generate(mockSchema, {
            endpoints: [],
            format: 'js',
            typecheck: true,
            authMode: 'legacy',
        })
        RefreshClient = (
            await import(pathToFileURL(path.join(refreshDir, 'index.js')).href)
        ).StrapiClient
        LegacyClient = (
            await import(pathToFileURL(path.join(legacyDir, 'index.js')).href)
        ).StrapiClient
    }, 60_000)

    afterAll(() => {
        fs.rmSync(refreshDir, { recursive: true, force: true })
        fs.rmSync(legacyDir, { recursive: true, force: true })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('without window and without tokenStorage the session flow stays inert', async () => {
        const backend = fakeBackend({
            login: () => json({ jwt: 'A', refreshToken: 'R1' }),
        })
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
        })
        await client.auth.login({ identifier: 'u', password: 'p' })
        await client.items.find().catch(() => undefined)
        expect(
            authHeader(backend.calls[backend.calls.length - 1].init),
        ).toBeUndefined()
    })

    it('login persists the refresh token and the access token is used as Bearer (no window needed)', async () => {
        const store = memoryStorage()
        const backend = fakeBackend({
            validTokens: ['A'],
            login: () =>
                json({ jwt: 'A', refreshToken: 'R1', user: { id: 1 } }),
        })
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: store.storage,
        })
        await client.auth.login({ identifier: 'u', password: 'p' })
        expect(store.value()).toBe('R1')
        await client.items.find()
        expect(authHeader(backend.calls[backend.calls.length - 1].init)).toBe(
            'Bearer A',
        )
    })

    it('cold start: auth.refresh() restores from storage, stores the rotated token and fires onTokenRefreshed', async () => {
        const store = memoryStorage('R1')
        const backend = fakeBackend({
            validTokens: ['B'],
            refresh: () => json({ jwt: 'B', refreshToken: 'R2' }),
        })
        const refreshed: unknown[] = []
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: store.storage,
            onTokenRefreshed: (t: unknown) => {
                // the rotated token must already be stored when the hook runs
                refreshed.push({ ...(t as object), stored: store.value() })
            },
        })

        await expect(client.auth.refresh()).resolves.toBe(true)

        expect(bodyOf(backend.refreshCalls()[0].init)).toEqual({
            refreshToken: 'R1',
        })
        expect(store.value()).toBe('R2')
        expect(refreshed).toEqual([
            { accessToken: 'B', refreshToken: 'R2', stored: 'R2' },
        ])
        await client.items.find()
        expect(authHeader(backend.calls[backend.calls.length - 1].init)).toBe(
            'Bearer B',
        )
    })

    it('empty storage: refresh() is false, makes no request and fires no hook', async () => {
        const store = memoryStorage()
        const backend = fakeBackend({ refresh: () => json({ jwt: 'B' }) })
        const hooks: string[] = []
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: store.storage,
            onTokenRefreshed: () => void hooks.push('refreshed'),
            onSessionExpired: () => void hooks.push('expired'),
        })
        await expect(client.auth.refresh()).resolves.toBe(false)
        expect(backend.calls).toEqual([])
        expect(hooks).toEqual([])
    })

    it('parallel anonymous requests after a cold start read storage once and refresh once', async () => {
        const store = memoryStorage('R1', { getDelay: 15 })
        const backend = fakeBackend({
            validTokens: ['B'],
            refresh: () => json({ jwt: 'B', refreshToken: 'R2' }),
        })
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: store.storage,
        })
        const results = await Promise.all([
            client.items.find(),
            client.items.find(),
            client.items.find(),
        ])
        expect(results).toEqual([[], [], []])
        expect(store.log.filter(l => l === 'get')).toHaveLength(1)
        expect(backend.refreshCalls()).toHaveLength(1)
        expect(store.value()).toBe('R2')
    })

    it('the refresh token is cached after the first read: later refreshes do not prompt again', async () => {
        const store = memoryStorage('R1')
        let n = 0
        const backend = fakeBackend({
            refresh: () =>
                json({ jwt: 'T' + ++n, refreshToken: 'R' + (n + 1) }),
        })
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: store.storage,
        })
        await client.auth.refresh()
        await client.auth.refresh()
        expect(store.log.filter(l => l === 'get')).toHaveLength(1)
        // the second refresh used the rotated token from memory
        expect(bodyOf(backend.refreshCalls()[1].init)).toEqual({
            refreshToken: 'R2',
        })
        expect(store.value()).toBe('R3')
    })

    it('a 4xx refresh clears storage, parks the session and fires onSessionExpired once', async () => {
        const store = memoryStorage('R1')
        const backend = fakeBackend({ refresh: () => unauthorized() })
        const expired: unknown[] = []
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: store.storage,
            onSessionExpired: (i: unknown) => void expired.push(i),
        })
        await expect(client.auth.refresh()).resolves.toBe(false)
        expect(store.value()).toBeUndefined()
        expect(expired).toEqual([{ reason: 'refresh-rejected', status: 401 }])
        // dead-session latch: a later 403 does not hit the backend again
        await client.items.find().catch(() => undefined)
        expect(backend.refreshCalls()).toHaveLength(1)
        expect(expired).toHaveLength(1)
    })

    it('a 5xx refresh is transient: storage kept, no onSessionExpired, retry works', async () => {
        const store = memoryStorage('R1')
        let fail = true
        const backend = fakeBackend({
            refresh: () =>
                fail
                    ? json({ error: { message: 'boom' } }, 503)
                    : json({ jwt: 'B', refreshToken: 'R2' }),
        })
        const expired: unknown[] = []
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: store.storage,
            onSessionExpired: (i: unknown) => void expired.push(i),
        })
        await expect(client.auth.refresh()).resolves.toBe(false)
        expect(store.value()).toBe('R1')
        expect(expired).toEqual([])
        fail = false
        await expect(client.auth.refresh()).resolves.toBe(true)
        expect(store.value()).toBe('R2')
    })

    it('a cancelled biometric prompt (getRefreshToken throws) is not a dead session', async () => {
        const store = memoryStorage('R1')
        store.failing.get = true
        const backend = fakeBackend({
            refresh: () => json({ jwt: 'B', refreshToken: 'R2' }),
        })
        const expired: unknown[] = []
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: store.storage,
            onSessionExpired: (i: unknown) => void expired.push(i),
        })
        await expect(client.auth.refresh()).resolves.toBe(false)
        expect(backend.calls).toEqual([])
        expect(store.value()).toBe('R1')
        expect(expired).toEqual([])
        // user retries and authenticates this time
        store.failing.get = false
        await expect(client.auth.refresh()).resolves.toBe(true)
        expect(store.value()).toBe('R2')
    })

    it('logout after a cold start revokes with the stored token, then clears storage without onSessionExpired', async () => {
        const store = memoryStorage('R1')
        const backend = fakeBackend({})
        const expired: unknown[] = []
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: store.storage,
            onSessionExpired: (i: unknown) => void expired.push(i),
        })
        await client.auth.logout()
        expect(bodyOf(backend.logoutCalls()[0].init)).toEqual({
            refreshToken: 'R1',
        })
        expect(store.value()).toBeUndefined()
        expect(expired).toEqual([])
    })

    it('sign-out wins the race against a refresh whose storage write is still pending', async () => {
        const store = memoryStorage('R1', { setDelay: 30 })
        const backend = fakeBackend({
            refresh: () => json({ jwt: 'B', refreshToken: 'R2' }),
        })
        const refreshed: unknown[] = []
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: store.storage,
            onTokenRefreshed: (t: unknown) => void refreshed.push(t),
        })
        const pending = client.auth.refresh()
        // let the refresh response land and the (slow) write start
        await new Promise(r => setTimeout(r, 10))
        await client.auth.clearToken()
        await expect(pending).resolves.toBe(false)
        expect(store.value()).toBeUndefined()
        expect(refreshed).toEqual([])
    })

    it('throwing hooks and a failing storage never break login or refresh', async () => {
        const backend = fakeBackend({
            validTokens: ['B'],
            refresh: () => json({ jwt: 'B', refreshToken: 'R2' }),
            login: () =>
                json({ jwt: 'A', refreshToken: 'R1', user: { id: 1 } }),
        })
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: {
                getRefreshToken: () => 'R1',
                setRefreshToken: () => {
                    throw new Error('disk full')
                },
                clearRefreshToken: () => {
                    throw new Error('disk full')
                },
            },
            onTokenRefreshed: () => {
                throw new Error('hook bug')
            },
        })
        await expect(
            client.auth.login({ identifier: 'u', password: 'p' }),
        ).resolves.toMatchObject({ jwt: 'A' })
        await expect(client.auth.refresh()).resolves.toBe(true)
        await expect(client.items.find()).resolves.toEqual([])
        await expect(client.auth.logout()).resolves.toBeUndefined()
    })

    it('a sync storage (e.g. MMKV) works too', async () => {
        let value: string | undefined = 'R1'
        const backend = fakeBackend({
            refresh: () => json({ jwt: 'B', refreshToken: 'R2' }),
        })
        const client = new RefreshClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: {
                getRefreshToken: () => value,
                setRefreshToken: (t: string) => {
                    value = t
                },
                clearRefreshToken: () => {
                    value = undefined
                },
            },
        })
        await expect(client.auth.refresh()).resolves.toBe(true)
        expect(value).toBe('R2')
    })

    it('legacy-mode clients ignore tokenStorage entirely', async () => {
        vi.stubGlobal('window', {})
        const store = memoryStorage('R1')
        const backend = fakeBackend({
            login: () => json({ jwt: 'A', refreshToken: 'R9' }),
        })
        const client = new LegacyClient({
            baseURL: 'http://x',
            fetch: backend.fetch,
            tokenStorage: store.storage,
        })
        await client.auth.login({ identifier: 'u', password: 'p' })
        expect(store.log).toEqual([])
        expect(store.value()).toBe('R1')
    })
})
