/**
 * Lightweight SSE (Server-Sent Events) client for Node.js.
 * Uses native fetch + ReadableStream — no dependencies.
 */

export interface SseEvent {
    event: string
    data: string
}

export interface SseConnectionOptions {
    url: string
    headers?: Record<string, string>
    onEvent: (event: SseEvent) => void
    onError?: (error: unknown) => void
}

/**
 * SSE connection with automatic reconnect and exponential backoff.
 *
 * Designed for the schema-watch use case: Strapi restarts break the
 * connection, the client reconnects automatically and receives the
 * fresh hash on the `connected` event.
 */
export class SseConnection {
    private opts: SseConnectionOptions
    private controller: AbortController | null = null
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private closed = false

    /** Current backoff delay in ms (resets on successful connect) */
    private backoff = 1000

    private static MIN_BACKOFF = 1000
    private static MAX_BACKOFF = 30_000

    constructor(opts: SseConnectionOptions) {
        this.opts = opts
    }

    /** Start the SSE connection. Safe to call multiple times. */
    connect(): void {
        if (this.closed) return
        this.abort()
        this.controller = new AbortController()
        this.run(this.controller.signal)
    }

    /** Permanently close the connection and cancel any pending reconnect. */
    close(): void {
        this.closed = true
        this.abort()
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
    }

    // ── internals ──────────────────────────────────────────────

    private abort(): void {
        if (this.controller) {
            this.controller.abort()
            this.controller = null
        }
    }

    private scheduleReconnect(): void {
        if (this.closed) return
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            this.connect()
        }, this.backoff)
        this.reconnectTimer.unref()
        this.backoff = Math.min(this.backoff * 2, SseConnection.MAX_BACKOFF)
    }

    private async run(signal: AbortSignal): Promise<void> {
        try {
            const res = await fetch(this.opts.url, {
                headers: {
                    Accept: 'text/event-stream',
                    ...this.opts.headers,
                },
                signal,
            })

            if (!res.ok || !res.body) {
                this.opts.onError?.(
                    new Error(`SSE request failed: ${res.status}`),
                )
                this.scheduleReconnect()
                return
            }

            // Successful connect — reset backoff
            this.backoff = SseConnection.MIN_BACKOFF

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buf = ''

            let currentEvent = ''
            let currentData = ''

            while (!signal.aborted) {
                const { done, value } = await reader.read()
                if (done) break

                buf += decoder.decode(value, { stream: true })

                // Process complete lines
                let nlIndex: number
                while ((nlIndex = buf.indexOf('\n')) !== -1) {
                    const line = buf.slice(0, nlIndex).replace(/\r$/, '')
                    buf = buf.slice(nlIndex + 1)

                    if (line === '') {
                        // Empty line = dispatch event
                        if (currentData) {
                            this.opts.onEvent({
                                event: currentEvent || 'message',
                                data: currentData,
                            })
                        }
                        currentEvent = ''
                        currentData = ''
                        continue
                    }

                    if (line.startsWith(':')) {
                        // Comment / heartbeat — ignore
                        continue
                    }

                    const colonIdx = line.indexOf(':')
                    if (colonIdx === -1) continue

                    const field = line.slice(0, colonIdx)
                    // Strip optional leading space after colon
                    const val =
                        line[colonIdx + 1] === ' '
                            ? line.slice(colonIdx + 2)
                            : line.slice(colonIdx + 1)

                    switch (field) {
                        case 'event':
                            currentEvent = val
                            break
                        case 'data':
                            currentData = currentData
                                ? currentData + '\n' + val
                                : val
                            break
                        // retry: ignored — we manage our own backoff
                    }
                }
            }
        } catch (err: unknown) {
            // AbortError is expected when we close() or reconnect()
            if (err instanceof DOMException && err.name === 'AbortError') return
            if (err instanceof Error && err.name === 'AbortError') return

            this.opts.onError?.(err)
        }

        // Stream ended or errored — reconnect
        this.scheduleReconnect()
    }
}
