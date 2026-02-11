/**
 * Filters Generator
 * Generates type-safe filter interfaces for Strapi entities
 */

import { ParsedSchema, ContentType, Attribute } from '../../schema-types.js'

/**
 * Generate filter utility types
 */
export function generateFilterUtilityTypes(): string {
    return `// ============================================
// Filter Utility Types
// ============================================

/** String filter operators */
export interface StringFilterOperators {
  $eq?: string
  $eqi?: string
  $ne?: string
  $nei?: string
  $in?: string[]
  $notIn?: string[]
  $contains?: string
  $notContains?: string
  $containsi?: string
  $notContainsi?: string
  $startsWith?: string
  $startsWithi?: string
  $endsWith?: string
  $endsWithi?: string
  $null?: boolean
  $notNull?: boolean
}

/** Number filter operators */
export interface NumberFilterOperators {
  $eq?: number
  $ne?: number
  $lt?: number
  $lte?: number
  $gt?: number
  $gte?: number
  $in?: number[]
  $notIn?: number[]
  $between?: [number, number]
  $null?: boolean
  $notNull?: boolean
}

/** Boolean filter operators */
export interface BooleanFilterOperators {
  $eq?: boolean
  $ne?: boolean
  $null?: boolean
  $notNull?: boolean
}

/** Date filter operators (dates are strings in Strapi) */
export interface DateFilterOperators {
  $eq?: string
  $ne?: string
  $lt?: string
  $lte?: string
  $gt?: string
  $gte?: string
  $in?: string[]
  $notIn?: string[]
  $between?: [string, string]
  $null?: boolean
  $notNull?: boolean
}

/** ID filter operators (for relations) */
export interface IdFilterOperators {
  $eq?: number | string
  $ne?: number | string
  $in?: (number | string)[]
  $notIn?: (number | string)[]
  $null?: boolean
  $notNull?: boolean
}

/** Relation filter - filter by nested fields */
export type RelationFilter<T> = {
  id?: number | IdFilterOperators
  documentId?: string | StringFilterOperators
} & {
  [K in keyof T]?: T[K] extends string
    ? string | StringFilterOperators
    : T[K] extends number
    ? number | NumberFilterOperators
    : T[K] extends boolean
    ? boolean | BooleanFilterOperators
    : any
}

/** Logical operators for combining filters */
export interface LogicalOperators<T> {
  $and?: T[]
  $or?: T[]
  $not?: T
}
`
}

/**
 * Get the filter type for an attribute
 */
function getFilterTypeForAttribute(attr: Attribute): string {
    const type = attr.type

    switch (type.kind) {
        case 'string':
        case 'text':
        case 'richtext':
        case 'email':
            return 'string | StringFilterOperators'

        case 'integer':
        case 'biginteger':
        case 'float':
        case 'decimal':
            return 'number | NumberFilterOperators'

        case 'boolean':
            return 'boolean | BooleanFilterOperators'

        case 'date':
        case 'datetime':
        case 'time':
            return 'string | DateFilterOperators'

        case 'enumeration': {
            const enumValues = type.values.map(v => `'${v}'`).join(' | ')
            return `(${enumValues}) | StringFilterOperators`
        }

        case 'json':
            return 'any' // JSON fields can have any filter

        default:
            return 'any'
    }
}

/**
 * Generate filter interface for a single content type
 */
export function generateEntityFilters(ct: ContentType): string {
    const lines: string[] = []
    const filterName = `${ct.cleanName}Filters`

    lines.push(`/** Type-safe filters for ${ct.cleanName} */`)
    lines.push(
        `export interface ${filterName} extends LogicalOperators<${filterName}> {`,
    )

    // Add id and documentId filters
    lines.push('  id?: number | IdFilterOperators')
    lines.push('  documentId?: string | StringFilterOperators')

    // Add filters for each attribute
    for (const attr of ct.attributes) {
        const filterType = getFilterTypeForAttribute(attr)
        const optional = '?'
        lines.push(`  ${attr.name}${optional}: ${filterType}`)
    }

    // Add filters for relations (simplified - just id filtering)
    for (const rel of ct.relations) {
        // For relations, allow filtering by id or nested filters
        lines.push(`  ${rel.name}?: {`)
        lines.push(`    id?: number | IdFilterOperators`)
        lines.push(`    documentId?: string | StringFilterOperators`)
        lines.push(`    [key: string]: any`)
        lines.push(`  }`)
    }

    // Add filters for media (by id)
    for (const media of ct.media) {
        lines.push(`  ${media.name}?: {`)
        lines.push(`    id?: number | IdFilterOperators`)
        lines.push(`    [key: string]: any`)
        lines.push(`  }`)
    }

    lines.push('}')

    return lines.join('\n')
}

/**
 * Generate all filter interfaces for the schema
 */
export function generateAllFilters(schema: ParsedSchema): string {
    const lines: string[] = []

    // Add utility types
    lines.push(generateFilterUtilityTypes())
    lines.push('')

    // Generate filter interface for each content type
    for (const ct of schema.contentTypes) {
        lines.push(generateEntityFilters(ct))
        lines.push('')
    }

    // Generate union type of all filters (useful for generic functions)
    const filterNames = schema.contentTypes.map(ct => `${ct.cleanName}Filters`)
    lines.push(`/** Union of all entity filters */`)
    lines.push(`export type AnyEntityFilters = ${filterNames.join(' | ')}`)
    lines.push('')

    // Generate a mapping type from entity to its filters
    lines.push(`/** Map from entity type to its filter type */`)
    lines.push(`export type EntityFiltersMap = {`)
    for (const ct of schema.contentTypes) {
        lines.push(`  ${ct.cleanName}: ${ct.cleanName}Filters`)
    }
    lines.push(`}`)

    return lines.join('\n')
}

/**
 * Generate typed QueryParams interface
 */
export function generateTypedQueryParams(): string {
    return `// ============================================
// Typed Query Parameters
// ============================================

/** Sort direction */
export type SortDirection = 'asc' | 'desc'

/** Sort option - can be a field name or field:direction */
export type SortOption<T> = keyof T & string | \`\${keyof T & string}:\${SortDirection}\`

/** Typed query parameters */
export interface TypedQueryParams<
  TEntity,
  TFilters = Record<string, any>,
  TPopulate = any
> {
  /** Type-safe filters */
  filters?: TFilters
  /** Sort by field(s) */
  sort?: SortOption<TEntity> | SortOption<TEntity>[]
  /** Pagination options */
  pagination?: {
    page?: number
    pageSize?: number
    limit?: number
    start?: number
  }
  /** Populate relations */
  populate?: TPopulate
  /** Select specific fields */
  fields?: (keyof TEntity)[]
}
`
}
