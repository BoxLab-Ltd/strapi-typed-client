import { ParsedSchema, ContentType, Component } from '../schema-types.js'
import { TypeTransformer } from '../transformer/index.js'
import {
    generateFilterUtilityTypes,
    generateEntityFilters,
    generateTypedQueryParams,
} from '../core/generator/filters-generator.js'

export class TypesGenerator {
    private transformer: TypeTransformer
    private schema?: ParsedSchema

    constructor() {
        this.transformer = new TypeTransformer()
    }

    generate(schema: ParsedSchema): string {
        this.schema = schema
        const lines: string[] = []

        // Add header comment
        lines.push('// Auto-generated TypeScript types from Strapi schema')
        lines.push('// Do not edit manually')
        lines.push('')

        // Generate base types
        lines.push(this.generateBaseTypes())
        lines.push('')

        // Generate helper types for populate params
        lines.push('// Helper types for field and sort options in populate')
        lines.push(
            "type _EntityField<T> = Exclude<keyof T & string, '__typename'>",
        )
        lines.push(
            'type _SortValue<T> = _EntityField<T> | `${_EntityField<T>}:${"asc" | "desc"}`',
        )
        lines.push('')
        lines.push(
            '// Apply fields narrowing from populate entry (e.g. populate: { item: { fields: ["title"] } })',
        )
        lines.push(
            "type _ApplyFields<TFull, TBase, TEntry> = TEntry extends true ? TFull : TEntry extends { fields: readonly (infer F)[] } ? F extends string ? Pick<TBase, Extract<F | 'id' | 'documentId', keyof TBase>> & Omit<TFull, keyof TBase> : TFull : TFull",
        )
        lines.push('')

        // Generate component types
        for (const component of schema.components) {
            lines.push(this.generateComponent(component))
            lines.push('')
        }

        // Generate component Input types
        for (const component of schema.components) {
            lines.push(this.generateComponentInput(component))
            lines.push('')
        }

        // Generate content type interfaces
        for (const contentType of schema.contentTypes) {
            lines.push(this.generateContentType(contentType))
            lines.push('')
        }

        // Generate Input types for create/update operations
        for (const contentType of schema.contentTypes) {
            lines.push(this.generateInputType(contentType))
            lines.push('')
        }

        // Generate PopulateParam types for type-safe populate
        lines.push(this.generatePopulateParams(schema))
        lines.push('')

        // Generate Payload utility types
        lines.push(this.generatePayloadUtilityTypes(schema))
        lines.push('')

        // Generate filter utility types
        lines.push(generateFilterUtilityTypes())
        lines.push('')

        // Generate typed query params
        lines.push(generateTypedQueryParams())
        lines.push('')

        // Generate entity-specific filters
        for (const contentType of schema.contentTypes) {
            lines.push(generateEntityFilters(contentType))
            lines.push('')
        }

        return lines.join('\n')
    }

    private generateBaseTypes(): string {
        return `// Base types

export interface MediaFile {
  id: number
  name: string
  alternativeText: string | null
  caption: string | null
  width: number | null
  height: number | null
  formats: unknown
  hash: string
  ext: string
  mime: string
  size: number
  url: string
  previewUrl: string | null
  provider: string
  createdAt: string
  updatedAt: string
}

// Strapi Blocks Editor API Types
// Based on: https://docs.strapi.io/dev-docs/api/document/blocks

/**
 * Main type for Strapi Blocks content
 */
export type BlocksContent = Block[]

/**
 * All possible block types
 */
export type Block =
  | ParagraphBlock
  | HeadingBlock
  | QuoteBlock
  | CodeBlock
  | ListBlock
  | ImageBlock

/**
 * Paragraph block - default text block
 */
export interface ParagraphBlock {
  type: 'paragraph'
  children: InlineNode[]
}

/**
 * Heading block - h1 to h6
 */
export interface HeadingBlock {
  type: 'heading'
  level: 1 | 2 | 3 | 4 | 5 | 6
  children: InlineNode[]
}

/**
 * Quote block - blockquote
 */
export interface QuoteBlock {
  type: 'quote'
  children: InlineNode[]
}

/**
 * Code block - preformatted code with optional language
 */
export interface CodeBlock {
  type: 'code'
  language?: string
  children: InlineNode[]
}

/**
 * List block - ordered or unordered
 */
export interface ListBlock {
  type: 'list'
  format: 'ordered' | 'unordered'
  children: ListItemBlock[]
}

/**
 * List item - individual item in a list
 */
export interface ListItemBlock {
  type: 'list-item'
  children: InlineNode[]
}

/**
 * Image block - embedded image with optional caption
 */
export interface ImageBlock {
  type: 'image'
  image: {
    name: string
    alternativeText?: string | null
    url: string
    caption?: string | null
    width?: number
    height?: number
    formats?: unknown
    hash: string
    ext: string
    mime: string
    size: number
    previewUrl?: string | null
    provider: string
    createdAt: string
    updatedAt: string
  }
  children: InlineNode[]
}

/**
 * Inline nodes - text formatting and inline elements
 */
export type InlineNode = TextNode | LinkInline

/**
 * Plain text node with optional formatting
 */
export interface TextNode {
  type: 'text'
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  code?: boolean
}

/**
 * Inline link
 */
export interface LinkInline {
  type: 'link'
  url: string
  children: TextNode[]
}`
    }

    private generateComponent(component: Component): string {
        const lines: string[] = []

        lines.push(`export interface ${component.cleanName} {`)

        // Add base id field (components have id in Strapi)
        lines.push('  id: number')

        // Add scalar attributes
        for (const attr of component.attributes) {
            const tsType = this.transformer.toTypeScript(
                attr.type,
                attr.required,
            )
            lines.push(`  ${attr.name}: ${tsType}`)
        }

        // Add media fields
        for (const mediaField of component.media) {
            const mediaType = mediaField.multiple ? 'MediaFile[]' : 'MediaFile'
            const suffix = mediaField.required ? '' : ' | null'
            lines.push(`  ${mediaField.name}: ${mediaType}${suffix}`)
        }

        // Add relations (reference by ID)
        for (const rel of component.relations) {
            const isArray =
                rel.relationType === 'oneToMany' ||
                rel.relationType === 'manyToMany'
            const relType = isArray
                ? '{ id: number; documentId: string }[]'
                : '{ id: number; documentId: string } | null'
            lines.push(`  ${rel.name}: ${relType}`)
        }

        // Add components
        for (const compField of component.components) {
            const compType = compField.repeatable
                ? `${compField.componentType}[]`
                : compField.componentType
            const suffix = compField.required ? '' : ' | null'
            lines.push(`  ${compField.name}: ${compType}${suffix}`)
        }

        // Add dynamic zones
        for (const dzField of component.dynamicZones) {
            const dzType = `(${dzField.componentTypes.join(' | ')})[]`
            const suffix = dzField.required ? '' : ' | null'
            lines.push(`  ${dzField.name}: ${dzType}${suffix}`)
        }

        lines.push('}')

        return lines.join('\n')
    }

    private generateComponentInput(component: Component): string {
        const lines: string[] = []

        lines.push(`// Input type for creating/updating ${component.cleanName}`)
        lines.push(`export interface ${component.cleanName}Input {`)

        // id is optional for input (omit when creating, include when updating existing)
        lines.push('  id?: number')

        // Add scalar attributes (all optional)
        for (const attr of component.attributes) {
            const tsType = this.transformer.toTypeScript(attr.type, false) // Always optional
            lines.push(`  ${attr.name}?: ${tsType}`)
        }

        // Add media fields as ID or ID array
        for (const mediaField of component.media) {
            const mediaType = mediaField.multiple ? 'number[]' : 'number'
            lines.push(`  ${mediaField.name}?: ${mediaType} | null`)
        }

        // Add relations as ID or ID array
        for (const rel of component.relations) {
            const isArray =
                rel.relationType === 'oneToMany' ||
                rel.relationType === 'manyToMany'
            const relType = isArray ? 'number[]' : 'number'
            lines.push(`  ${rel.name}?: ${relType} | null`)
        }

        // Add nested components
        for (const compField of component.components) {
            const compType = compField.repeatable
                ? `${compField.componentType}Input[]`
                : `${compField.componentType}Input`
            lines.push(`  ${compField.name}?: ${compType} | null`)
        }

        // Add dynamic zones
        for (const dzField of component.dynamicZones) {
            const dzType = `(${dzField.componentTypes.map(ct => `${ct}Input`).join(' | ')})[]`
            lines.push(`  ${dzField.name}?: ${dzType} | null`)
        }

        lines.push('}')

        return lines.join('\n')
    }

    private generateContentType(contentType: ContentType): string {
        const lines: string[] = []

        lines.push(`export interface ${contentType.cleanName} {`)

        // Add nominal typing field to make types structurally unique
        lines.push(`  readonly __typename?: '${contentType.cleanName}'`)

        // Add base fields
        lines.push('  id: number')
        lines.push('  documentId: string')
        lines.push('  createdAt: string')
        lines.push('  updatedAt: string')

        // Add custom attributes
        for (const attr of contentType.attributes) {
            const tsType = this.transformer.toTypeScript(
                attr.type,
                attr.required,
            )
            lines.push(`  ${attr.name}: ${tsType}`)
        }

        lines.push('}')

        return lines.join('\n')
    }

    private generateInputType(contentType: ContentType): string {
        const lines: string[] = []

        lines.push(
            `// Input type for creating/updating ${contentType.cleanName}`,
        )
        lines.push(`export interface ${contentType.cleanName}Input {`)

        // Add scalar attributes (all optional for partial updates)
        for (const attr of contentType.attributes) {
            const tsType = this.transformer.toTypeScript(attr.type, false) // Always optional
            lines.push(`  ${attr.name}?: ${tsType}`)
        }

        // Add media fields as ID or ID array
        for (const mediaField of contentType.media) {
            const mediaType = mediaField.multiple ? 'number[]' : 'number'
            lines.push(`  ${mediaField.name}?: ${mediaType} | null`)
        }

        // Add relations as ID or ID array
        for (const rel of contentType.relations) {
            const isArray =
                rel.relationType === 'oneToMany' ||
                rel.relationType === 'manyToMany'
            const relType = isArray ? 'number[]' : 'number'
            lines.push(`  ${rel.name}?: ${relType} | null`)
        }

        // Add components as objects (using component type, but with optional fields)
        for (const compField of contentType.components) {
            const compType = compField.repeatable
                ? `${compField.componentType}Input[]`
                : `${compField.componentType}Input`
            lines.push(`  ${compField.name}?: ${compType} | null`)
        }

        // Add dynamic zones
        for (const dzField of contentType.dynamicZones) {
            const dzType = `(${dzField.componentTypes.map(ct => `${ct}Input`).join(' | ')})[]`
            lines.push(`  ${dzField.name}?: ${dzType} | null`)
        }

        lines.push('}')

        return lines.join('\n')
    }

    private generatePopulateParams(schema: ParsedSchema): string {
        const lines: string[] = []

        lines.push('// ============================================')
        lines.push('// PopulateParam types for type-safe populate')
        lines.push('// ============================================')
        lines.push('')

        // Generate for components with populatable fields
        for (const component of schema.components) {
            const result = this.generatePopulateParamForType(component)
            if (result) {
                lines.push(result)
                lines.push('')
            }
        }

        // Generate for content types with populatable fields
        for (const contentType of schema.contentTypes) {
            const result = this.generatePopulateParamForType(contentType)
            if (result) {
                lines.push(result)
                lines.push('')
            }
        }

        return lines.join('\n')
    }

    private generatePopulateParamForType(
        type: ContentType | Component,
    ): string | null {
        const populatableFields: string[] = []

        // Collect all populatable field entries
        for (const rel of type.relations) {
            const t = rel.targetType
            const targetHasPopulate = this.hasPopulatableFields(t)
            const options = [`fields?: _EntityField<${t}>[]`]
            if (targetHasPopulate) {
                options.push(
                    `populate?: ${t}PopulateParam | (keyof ${t}PopulateParam & string)[] | '*'`,
                )
            }
            options.push(`filters?: ${t}Filters`)
            options.push(`sort?: _SortValue<${t}> | _SortValue<${t}>[]`)
            options.push(`limit?: number`)
            options.push(`start?: number`)
            populatableFields.push(
                `  ${rel.name}?: true | { ${options.join('; ')} }`,
            )
        }

        for (const media of type.media) {
            populatableFields.push(
                `  ${media.name}?: true | { fields?: (keyof MediaFile & string)[] }`,
            )
        }

        for (const comp of type.components) {
            const t = comp.componentType
            const targetHasPopulate = this.hasPopulatableFields(t)
            const options = [`fields?: (keyof ${t} & string)[]`]
            if (targetHasPopulate) {
                options.push(
                    `populate?: ${t}PopulateParam | (keyof ${t}PopulateParam & string)[] | '*'`,
                )
            }
            populatableFields.push(
                `  ${comp.name}?: true | { ${options.join('; ')} }`,
            )
        }

        for (const dz of type.dynamicZones) {
            // Dynamic zone: support Strapi v5 "on" fragment syntax
            const onEntries: string[] = []
            for (let i = 0; i < dz.components.length; i++) {
                const uid = dz.components[i]
                const cleanType = dz.componentTypes[i]
                const hasPopulate = this.hasPopulatableFields(cleanType)
                const options = [`fields?: (keyof ${cleanType} & string)[]`]
                if (hasPopulate) {
                    options.push(
                        `populate?: ${cleanType}PopulateParam | (keyof ${cleanType}PopulateParam & string)[] | '*'`,
                    )
                }
                onEntries.push(`'${uid}'?: true | { ${options.join('; ')} }`)
            }
            populatableFields.push(
                `  ${dz.name}?: true | { on?: { ${onEntries.join('; ')} } }`,
            )
        }

        if (populatableFields.length === 0) return null

        const lines: string[] = []
        lines.push(`export type ${type.cleanName}PopulateParam = {`)
        lines.push(...populatableFields)
        lines.push('}')
        return lines.join('\n')
    }

    private generatePayloadUtilityTypes(schema: ParsedSchema): string {
        const lines: string[] = []

        lines.push('// Prisma-like Payload types for populate support')
        lines.push('// These types allow type-safe population of relations')
        lines.push('//')
        lines.push('// Usage example:')
        lines.push(
            '// type ItemWithCategory = ItemGetPayload<{ populate: { category: true } }>',
        )
        lines.push(
            '// const items = await strapi.items.find({ populate: { category: true } }) as ItemWithCategory[]',
        )
        lines.push('//')
        lines.push(
            '// This ensures that relations are only included in the type when populate is used',
        )
        lines.push('')

        // Generate GetPayload type for each component with populatable fields
        for (const component of schema.components) {
            const hasPopulatableFields =
                component.relations.length > 0 ||
                component.media.length > 0 ||
                component.components.length > 0 ||
                component.dynamicZones.length > 0

            if (hasPopulatableFields) {
                lines.push(this.generateComponentGetPayloadType(component))
                lines.push('')
            }
        }

        // Generate GetPayload type for each content type with populatable fields
        for (const contentType of schema.contentTypes) {
            const hasPopulatableFields =
                contentType.relations.length > 0 ||
                contentType.media.length > 0 ||
                contentType.components.length > 0 ||
                contentType.dynamicZones.length > 0

            if (hasPopulatableFields) {
                lines.push(this.generateGetPayloadType(contentType))
                lines.push('')
            }
        }

        return lines.join('\n')
    }

    private generateGetPayloadType(contentType: ContentType): string {
        const lines: string[] = []

        lines.push(
            `// Payload type for ${contentType.cleanName} with populate support`,
        )
        lines.push(
            `export type ${contentType.cleanName}GetPayload<P extends { populate?: any } = {}> =`,
        )
        lines.push(`  ${contentType.cleanName} &`)

        const hasPopulatableFields =
            contentType.relations.length > 0 ||
            contentType.media.length > 0 ||
            contentType.components.length > 0 ||
            contentType.dynamicZones.length > 0

        if (!hasPopulatableFields) {
            lines.push(`  {}`)
        } else {
            lines.push(`  (P extends { populate: infer Pop }`)

            // Branch 1: Pop extends '*' | true → populate ALL fields (1 level deep)
            lines.push(`    ? Pop extends '*' | true`)
            lines.push(`      ? {`)
            this.generateAllPopulatedFields(lines, contentType)
            lines.push(`        }`)

            // Branch 2: Pop is a string array → check field name in array values
            lines.push(`      : Pop extends readonly (infer _)[]`)
            lines.push(`        ? {`)
            this.generateArrayPopulatedFields(lines, contentType)
            lines.push(`          }`)

            // Branch 3: Pop is an object → per-field conditional populate
            lines.push(`        : {`)
            this.generatePerFieldPopulate(lines, contentType)
            lines.push(`          }`)

            lines.push(`    : {})`)
        }

        return lines.join('\n')
    }

    /**
     * Generate fields for populate: '*' | true — all populatable fields with base types
     */
    private generateAllPopulatedFields(
        lines: string[],
        type: ContentType | Component,
    ): void {
        for (const rel of type.relations) {
            const isNullable =
                rel.relationType === 'oneToOne' ||
                rel.relationType === 'manyToOne'
            const isArray =
                rel.relationType === 'oneToMany' ||
                rel.relationType === 'manyToMany'
            const nullSuffix = isNullable ? ' | null' : ''
            const arraySuffix = isArray ? '[]' : ''
            lines.push(
                `          ${rel.name}?: ${rel.targetType}${arraySuffix}${nullSuffix}`,
            )
        }

        for (const mediaField of type.media) {
            const mediaType = mediaField.multiple ? 'MediaFile[]' : 'MediaFile'
            lines.push(`          ${mediaField.name}?: ${mediaType}`)
        }

        for (const componentField of type.components) {
            const arraySuffix = componentField.repeatable ? '[]' : ''
            lines.push(
                `          ${componentField.name}?: ${componentField.componentType}${arraySuffix}`,
            )
        }

        for (const dzField of type.dynamicZones) {
            const unionType = dzField.componentTypes.join(' | ')
            lines.push(`          ${dzField.name}?: (${unionType})[]`)
        }
    }

    /**
     * Generate fields for array-style populate (e.g. populate: ['category', 'image'])
     * Each field checks if its name is in Pop[number]
     */
    private generateArrayPopulatedFields(
        lines: string[],
        type: ContentType | Component,
    ): void {
        for (const rel of type.relations) {
            const isNullable =
                rel.relationType === 'oneToOne' ||
                rel.relationType === 'manyToOne'
            const isArray =
                rel.relationType === 'oneToMany' ||
                rel.relationType === 'manyToMany'
            const nullSuffix = isNullable ? ' | null' : ''
            const arraySuffix = isArray ? '[]' : ''
            lines.push(
                `            ${rel.name}?: '${rel.name}' extends Pop[number] ? ${rel.targetType}${arraySuffix}${nullSuffix} : never`,
            )
        }

        for (const mediaField of type.media) {
            const mediaType = mediaField.multiple ? 'MediaFile[]' : 'MediaFile'
            lines.push(
                `            ${mediaField.name}?: '${mediaField.name}' extends Pop[number] ? ${mediaType} : never`,
            )
        }

        for (const componentField of type.components) {
            const arraySuffix = componentField.repeatable ? '[]' : ''
            lines.push(
                `            ${componentField.name}?: '${componentField.name}' extends Pop[number] ? ${componentField.componentType}${arraySuffix} : never`,
            )
        }

        for (const dzField of type.dynamicZones) {
            const unionType = dzField.componentTypes.join(' | ')
            lines.push(
                `            ${dzField.name}?: '${dzField.name}' extends Pop[number] ? (${unionType})[] : never`,
            )
        }
    }

    /**
     * Generate per-field conditional populate for object-style populate params
     */
    private generatePerFieldPopulate(
        lines: string[],
        type: ContentType | Component,
    ): void {
        for (const rel of type.relations) {
            const isNullable =
                rel.relationType === 'oneToOne' ||
                rel.relationType === 'manyToOne'
            const isArray =
                rel.relationType === 'oneToMany' ||
                rel.relationType === 'manyToMany'
            const baseType = rel.targetType
            const nullSuffix = isNullable ? ' | null' : ''
            const arraySuffix = isArray ? '[]' : ''
            const hasPopulate = this.hasPopulatableFields(baseType)

            lines.push(
                `          ${rel.name}?: '${rel.name}' extends keyof Pop`,
            )
            if (hasPopulate) {
                lines.push(
                    `            ? _ApplyFields<Pop['${rel.name}'] extends { populate: infer NestedPop } ? ${baseType}GetPayload<{ populate: NestedPop }> : ${baseType}, ${baseType}, Pop['${rel.name}']>${arraySuffix}${nullSuffix}`,
                )
            } else {
                lines.push(
                    `            ? _ApplyFields<${baseType}, ${baseType}, Pop['${rel.name}']>${arraySuffix}${nullSuffix}`,
                )
            }
            lines.push(`            : never`)
        }

        for (const mediaField of type.media) {
            const arraySuffix = mediaField.multiple ? '[]' : ''
            lines.push(
                `          ${mediaField.name}?: '${mediaField.name}' extends keyof Pop ? _ApplyFields<MediaFile, MediaFile, Pop['${mediaField.name}']>${arraySuffix} : never`,
            )
        }

        for (const componentField of type.components) {
            const baseType = componentField.componentType
            const arraySuffix = componentField.repeatable ? '[]' : ''
            const hasPopulate = this.hasPopulatableFields(baseType)

            lines.push(
                `          ${componentField.name}?: '${componentField.name}' extends keyof Pop`,
            )
            if (hasPopulate) {
                lines.push(
                    `            ? _ApplyFields<Pop['${componentField.name}'] extends { populate: infer NestedPop } ? ${baseType}GetPayload<{ populate: NestedPop }> : ${baseType}, ${baseType}, Pop['${componentField.name}']>${arraySuffix}`,
                )
            } else {
                lines.push(
                    `            ? _ApplyFields<${baseType}, ${baseType}, Pop['${componentField.name}']>${arraySuffix}`,
                )
            }
            lines.push(`            : never`)
        }

        for (const dzField of type.dynamicZones) {
            const unionType = dzField.componentTypes.join(' | ')
            const dzType = `(${unionType})[]`
            lines.push(
                `          ${dzField.name}?: '${dzField.name}' extends keyof Pop ? ${dzType} : never`,
            )
        }
    }

    private generateComponentGetPayloadType(component: Component): string {
        const lines: string[] = []

        lines.push(
            `// Payload type for ${component.cleanName} with populate support`,
        )
        lines.push(
            `export type ${component.cleanName}GetPayload<P extends { populate?: any } = {}> =`,
        )
        lines.push(`  ${component.cleanName} &`)

        const hasPopulatableFields =
            component.relations.length > 0 ||
            component.media.length > 0 ||
            component.components.length > 0 ||
            component.dynamicZones.length > 0

        if (!hasPopulatableFields) {
            lines.push(`  {}`)
        } else {
            lines.push(`  (P extends { populate: infer Pop }`)

            // Branch 1: Pop extends '*' | true → populate ALL fields (1 level deep)
            lines.push(`    ? Pop extends '*' | true`)
            lines.push(`      ? {`)
            this.generateAllPopulatedFields(lines, component)
            lines.push(`        }`)

            // Branch 2: Pop is a string array → check field name in array values
            lines.push(`      : Pop extends readonly (infer _)[]`)
            lines.push(`        ? {`)
            this.generateArrayPopulatedFields(lines, component)
            lines.push(`          }`)

            // Branch 3: Pop is an object → per-field conditional populate
            lines.push(`        : {`)
            this.generatePerFieldPopulate(lines, component)
            lines.push(`          }`)

            lines.push(`    : {})`)
        }

        return lines.join('\n')
    }

    /**
     * Check if a type (by name) has populatable fields (relations, media, components, or dynamic zones)
     */
    private hasPopulatableFields(typeName: string): boolean {
        if (!this.schema) return false

        // Check in content types
        const contentType = this.schema.contentTypes.find(
            ct => ct.cleanName === typeName,
        )
        if (contentType) {
            return (
                contentType.relations.length > 0 ||
                contentType.media.length > 0 ||
                contentType.components.length > 0 ||
                contentType.dynamicZones.length > 0
            )
        }

        // Check in components
        const component = this.schema.components.find(
            comp => comp.cleanName === typeName,
        )
        if (component) {
            return (
                component.relations.length > 0 ||
                component.media.length > 0 ||
                component.components.length > 0 ||
                component.dynamicZones.length > 0
            )
        }

        return false
    }
}
