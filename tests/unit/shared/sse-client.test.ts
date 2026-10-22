import { describe, it, expect, vi, afterEach } from 'vitest'
import { SseConnection } from '../../../src/shared/sse-client.js'

async function reconnectTimerOf(
    keepAlive: boolean | undefined,
): Promise<{ conn: SseConnection; timer: { hasRef(): boolean } }> {
    const conn = new SseConnection({
        url: 'http://localhost:1337/sse',
        onEvent: () => {},
        onError: () => {},
        keepAlive,
    })
    conn.connect()
    await vi.waitFor(() => {
        expect(
            (conn as unknown as { reconnectTimer: unknown }).reconnectTimer,
        ).not.toBeNull()
    })
    const timer = (conn as unknown as { reconnectTimer: { hasRef(): boolean } })
        .reconnectTimer
    return { conn, timer }
}

describe('SseConnection reconnect timer', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('keeps the event loop alive with keepAlive (#104)', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new Error('terminated')),
        )
        const { conn, timer } = await reconnectTimerOf(true)
        expect(timer.hasRef()).toBe(true)
        conn.close()
    })

    it('does not hold the event loop open by default', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new Error('terminated')),
        )
        const { conn, timer } = await reconnectTimerOf(undefined)
        expect(timer.hasRef()).toBe(false)
        conn.close()
    })
})
