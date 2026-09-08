/**
 * Single source of truth for the shape of a generated API method: its
 * parameter list and its `this.request` call.
 *
 * Custom routes, auth and the plugin registry each assembled both by hand,
 * three parallel implementations of one pattern — and `nextOptions` fell out
 * of one of them entirely plus two hand-rolled auth special cases (#89).
 * Anything that must hold for every generated request belongs here, so a new
 * generator inherits it instead of re-deriving it.
 *
 * Emitted text is not whitespace-sensitive: the generator runs prettier over
 * every file before writing it.
 */

/** Trailing parameter every request-issuing method carries. */
export const NEXT_OPTIONS_PARAM = 'nextOptions?: NextOptions'

/** The matching argument name, third positional slot of `request`. */
export const NEXT_OPTIONS_ARG = 'nextOptions'

export interface MethodParamsSpec {
    /** Path parameters in declaration order; always typed `string`. */
    pathParams?: readonly string[]
    /** Request body, for POST/PUT/PATCH. */
    data?: { name?: string; type: string; optional?: boolean }
    /** Query parameters. */
    query?: { name?: string; type: string; optional?: boolean }
    /** Anything caller-specific that must precede `nextOptions`. */
    extra?: readonly string[]
}

/**
 * Build a method's parameter list. `nextOptions` is appended unconditionally —
 * that is the whole point of routing signatures through here.
 */
export function buildMethodParams(spec: MethodParamsSpec = {}): string {
    const params: string[] = []

    for (const param of spec.pathParams ?? []) {
        params.push(`${param}: string`)
    }

    if (spec.data) {
        const name = spec.data.name ?? 'data'
        const optional = spec.data.optional ?? true
        params.push(`${name}${optional ? '?' : ''}: ${spec.data.type}`)
    }

    if (spec.query) {
        const name = spec.query.name ?? 'params'
        const optional = spec.query.optional ?? true
        params.push(`${name}${optional ? '?' : ''}: ${spec.query.type}`)
    }

    params.push(...(spec.extra ?? []))
    params.push(NEXT_OPTIONS_PARAM)

    return params.join(', ')
}

export interface RequestCallSpec {
    /** Type argument for `request<...>`. */
    responseType: string
    /** URL expression; defaults to the local `url` binding. */
    url?: string
    /**
     * `RequestInit` literal. Defaults to `{}` — a GET still has to pass it so
     * `nextOptions` lands in the third slot rather than being read as the init.
     */
    init?: string
    /** Error-message prefix, when the caller emits one. */
    errorPrefix?: string
}

/**
 * Build a `this.request(...)` call with `nextOptions` in its third positional
 * slot. Passing it second — where `RequestInit` goes — type-checks against the
 * generated client and silently drops every Next.js option, so the argument
 * order is fixed here rather than at each call site.
 */
export function buildRequestCall(spec: RequestCallSpec): string {
    const args = [
        spec.url ?? 'url',
        spec.init ?? '{}',
        NEXT_OPTIONS_ARG,
        ...(spec.errorPrefix ? [`'${spec.errorPrefix}'`] : []),
    ]

    return `this.request<${spec.responseType}>(${args.join(', ')})`
}
