/**
 * JSON Schema → TypeScript type expression, for the request/response schemas
 * Strapi routes carry (Zod 4, converted with `toJSONSchema`). Covers the subset
 * Zod emits; anything it can't express precisely degrades to `unknown`.
 * Deterministic: the output follows the schema's own key and member order.
 */

type Schema = Record<string, unknown>

const isSchema = (value: unknown): value is Schema =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

export function jsonSchemaToTs(schema: unknown): string {
    const root = isSchema(schema) ? schema : {}
    const defs: Record<string, unknown> = {
        ...(isSchema(root.definitions) ? root.definitions : {}),
        ...(isSchema(root.$defs) ? root.$defs : {}),
    }
    return convert(schema, defs, new Set())
}

function convert(
    schema: unknown,
    defs: Record<string, unknown>,
    seen: ReadonlySet<string>,
): string {
    if (schema === false) return 'never'
    if (!isSchema(schema)) return 'unknown'
    const next = (s: unknown) => convert(s, defs, seen)

    if (typeof schema.$ref === 'string') {
        const match = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(schema.$ref)
        const name = match?.[1]?.replace(/~1/g, '/').replace(/~0/g, '~')
        // A recursive schema can't be inlined into one expression
        if (!name || seen.has(name) || !(name in defs)) return 'unknown'
        return convert(defs[name], defs, new Set([...seen, name]))
    }

    let type: string
    if ('const' in schema) type = literal(schema.const)
    else if (Array.isArray(schema.enum)) type = union(schema.enum.map(literal))
    else if (Array.isArray(schema.anyOf)) type = union(schema.anyOf.map(next))
    else if (Array.isArray(schema.oneOf)) type = union(schema.oneOf.map(next))
    else if (Array.isArray(schema.allOf))
        type = intersection(schema.allOf.map(next))
    else if (Array.isArray(schema.type))
        type = union(
            schema.type.map(t => fromType(String(t), schema, defs, seen)),
        )
    else if (typeof schema.type === 'string')
        type = fromType(schema.type, schema, defs, seen)
    else if (isSchema(schema.properties) || 'additionalProperties' in schema)
        type = fromType('object', schema, defs, seen)
    else if ('items' in schema || Array.isArray(schema.prefixItems))
        type = fromType('array', schema, defs, seen)
    else type = 'unknown'

    // OpenAPI 3.0 style
    return schema.nullable === true ? union([type, 'null']) : type
}

function fromType(
    type: string,
    schema: Schema,
    defs: Record<string, unknown>,
    seen: ReadonlySet<string>,
): string {
    const next = (s: unknown) => convert(s, defs, seen)
    switch (type) {
        case 'string':
            return 'string'
        case 'number':
        case 'integer':
            return 'number'
        case 'boolean':
            return 'boolean'
        case 'null':
            return 'null'
        case 'array': {
            if (Array.isArray(schema.prefixItems)) {
                const items = schema.prefixItems.map(next)
                const rest =
                    'items' in schema && schema.items !== false
                        ? [`...${arrayOf(next(schema.items))}`]
                        : []
                return `[${[...items, ...rest].join(', ')}]`
            }
            return arrayOf('items' in schema ? next(schema.items) : 'unknown')
        }
        case 'object': {
            const properties = isSchema(schema.properties)
                ? Object.entries(schema.properties)
                : []
            const required = new Set(
                Array.isArray(schema.required) ? schema.required : [],
            )
            const extra = schema.additionalProperties
            const extraType =
                extra === undefined || extra === true
                    ? properties.length > 0 && extra === undefined
                        ? undefined
                        : 'unknown'
                    : extra === false
                      ? undefined
                      : next(extra)
            if (properties.length === 0) {
                return extraType === undefined
                    ? 'Record<string, never>'
                    : `Record<string, ${extraType}>`
            }
            const members = properties.map(
                ([key, value]) =>
                    `${safeKey(key)}${required.has(key) ? '' : '?'}: ${next(value)}`,
            )
            // An index signature must admit every declared property type
            if (extraType !== undefined) members.push('[key: string]: unknown')
            return `{ ${members.join('; ')} }`
        }
        default:
            return 'unknown'
    }
}

function literal(value: unknown): string {
    return value === undefined ? 'undefined' : JSON.stringify(value)
}

function union(members: string[]): string {
    const unique = [...new Set(members)]
    if (unique.includes('unknown')) return 'unknown'
    if (unique.length === 0) return 'never'
    return unique.join(' | ')
}

function intersection(members: string[]): string {
    const unique = [...new Set(members)].filter(m => m !== 'unknown')
    if (unique.length === 0) return 'unknown'
    return unique.map(m => (hasTopLevel(m, '|') ? `(${m})` : m)).join(' & ')
}

function arrayOf(element: string): string {
    return hasTopLevel(element, '|') || hasTopLevel(element, '&')
        ? `(${element})[]`
        : `${element}[]`
}

// Whether `op` appears outside any brackets or string literals
function hasTopLevel(type: string, op: '|' | '&'): boolean {
    let depth = 0
    let quote: string | null = null
    for (let i = 0; i < type.length; i++) {
        const ch = type[i]!
        if (quote) {
            if (ch === '\\') i++
            else if (ch === quote) quote = null
        } else if (ch === '"' || ch === "'") quote = ch
        else if ('{[(<'.includes(ch)) depth++
        else if ('}])>'.includes(ch)) depth--
        else if (ch === op && depth === 0) return true
    }
    return false
}

export function safeKey(name: string): string {
    return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)
}
