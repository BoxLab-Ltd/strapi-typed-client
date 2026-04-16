export function stringifyQuery(obj: Record<string, unknown>): string {
    const pairs: string[] = []
    for (const key of Object.keys(obj)) {
        appendEntry(obj[key], key, pairs)
    }
    return pairs.join('&')
}

export function appendEntry(
    value: unknown,
    prefix: string,
    pairs: string[],
): void {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            appendEntry(value[i], `${prefix}[${i}]`, pairs)
        }
        return
    }
    if (value instanceof Date) {
        pairs.push(`${prefix}=${encodeURIComponent(value.toISOString())}`)
        return
    }
    if (typeof value === 'object') {
        for (const key of Object.keys(value as Record<string, unknown>)) {
            appendEntry(
                (value as Record<string, unknown>)[key],
                `${prefix}[${key}]`,
                pairs,
            )
        }
        return
    }
    pairs.push(`${prefix}=${encodeURIComponent(String(value))}`)
}
