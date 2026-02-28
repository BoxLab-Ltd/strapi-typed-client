import { Project, SourceFile } from 'ts-morph'
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
        const project = new Project({ useInMemoryFileSystem: true })
        const sf = project.createSourceFile('types.ts')

        // Header comments
        sf.addStatements([
            '// Auto-generated TypeScript types from Strapi schema',
            '// Do not edit manually',
        ])

        // Base types (static block)
        sf.addStatements(this.generateBaseTypes())

        // Helper types (static block)
        sf.addStatements(this.generateHelperTypes())

        // Component interfaces
        for (const component of schema.components) {
            this.addComponentInterface(sf, component)
        }

        // Component Input interfaces
        for (const component of schema.components) {
            this.addComponentInputInterface(sf, component)
        }

        // Content type interfaces
        for (const contentType of schema.contentTypes) {
            this.addContentTypeInterface(sf, contentType)
        }

        // Input type interfaces
        for (const contentType of schema.contentTypes) {
            this.addInputTypeInterface(sf, contentType)
        }

        // PopulateParam types
        this.addPopulateParams(sf, schema)

        // Payload utility types
        this.addPayloadUtilityTypes(sf, schema)

        // Filter utility types (static block)
        sf.addStatements(generateFilterUtilityTypes())

        // Typed query params (static block)
        sf.addStatements(generateTypedQueryParams())

        // Entity-specific filters
        for (const contentType of schema.contentTypes) {
            sf.addStatements(generateEntityFilters(contentType))
        }

        return sf.getFullText()
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

    private generateHelperTypes(): string {
        return `// Helper types for field and sort options in populate
type _EntityField<T> = Exclude<keyof T & string, '__typename'>
type _SortValue<T> = _EntityField<T> | \`\${_EntityField<T>}:\${"asc" | "desc"}\`

// Apply fields narrowing from populate entry (e.g. populate: { item: { fields: ["title"] } })
type _ApplyFields<TFull, TBase, TEntry> = TEntry extends true ? TFull : TEntry extends { fields: readonly (infer F)[] } ? F extends string ? Pick<TBase, Extract<F | 'id' | 'documentId', keyof TBase>> & Omit<TFull, keyof TBase> : TFull : TFull`
    }

    private addComponentInterface(sf: SourceFile, component: Component): void {
        sf.addInterface({
            name: component.cleanName,
            isExported: true,
            properties: [
                { name: 'id', type: 'number' },
                { name: '__component', type: `'${component.uid}'` },
                ...component.attributes.map(attr => ({
                    name: attr.name,
                    type: this.transformer.toTypeScript(
                        attr.type,
                        attr.required,
                    ),
                })),
                ...component.media.map(mediaField => {
                    const mediaType = mediaField.multiple
                        ? 'MediaFile[]'
                        : 'MediaFile'
                    const suffix = mediaField.required ? '' : ' | null'
                    return {
                        name: mediaField.name,
                        type: `${mediaType}${suffix}`,
                    }
                }),
                ...component.relations.map(rel => {
                    const isArray =
                        rel.relationType === 'oneToMany' ||
                        rel.relationType === 'manyToMany'
                    return {
                        name: rel.name,
                        type: isArray
                            ? '{ id: number; documentId: string }[]'
                            : '{ id: number; documentId: string } | null',
                    }
                }),
                ...component.components.map(compField => {
                    const compType = compField.repeatable
                        ? `${compField.componentType}[]`
                        : compField.componentType
                    const suffix = compField.required ? '' : ' | null'
                    return {
                        name: compField.name,
                        type: `${compType}${suffix}`,
                    }
                }),
                ...component.dynamicZones.map(dzField => {
                    const dzType = `(${dzField.componentTypes.join(' | ')})[]`
                    const suffix = dzField.required ? '' : ' | null'
                    return {
                        name: dzField.name,
                        type: `${dzType}${suffix}`,
                    }
                }),
            ],
        })
    }

    private addComponentInputInterface(
        sf: SourceFile,
        component: Component,
    ): void {
        sf.addInterface({
            name: `${component.cleanName}Input`,
            docs: [`Input type for creating/updating ${component.cleanName}`],
            isExported: true,
            properties: [
                { name: 'id', type: 'number', hasQuestionToken: true },
                { name: '__component', type: `'${component.uid}'` },
                ...component.attributes.map(attr => ({
                    name: attr.name,
                    type: this.transformer.toTypeScript(attr.type, false),
                    hasQuestionToken: true,
                })),
                ...component.media.map(mediaField => ({
                    name: mediaField.name,
                    type: `${mediaField.multiple ? 'number[]' : 'number'} | null`,
                    hasQuestionToken: true,
                })),
                ...component.relations.map(rel => {
                    const isArray =
                        rel.relationType === 'oneToMany' ||
                        rel.relationType === 'manyToMany'
                    return {
                        name: rel.name,
                        type: `${isArray ? 'number[]' : 'number'} | null`,
                        hasQuestionToken: true,
                    }
                }),
                ...component.components.map(compField => {
                    const compType = compField.repeatable
                        ? `${compField.componentType}Input[]`
                        : `${compField.componentType}Input`
                    return {
                        name: compField.name,
                        type: `${compType} | null`,
                        hasQuestionToken: true,
                    }
                }),
                ...component.dynamicZones.map(dzField => ({
                    name: dzField.name,
                    type: `(${dzField.componentTypes.map(ct => `${ct}Input`).join(' | ')})[] | null`,
                    hasQuestionToken: true,
                })),
            ],
        })
    }

    private addContentTypeInterface(
        sf: SourceFile,
        contentType: ContentType,
    ): void {
        sf.addInterface({
            name: contentType.cleanName,
            isExported: true,
            properties: [
                {
                    name: '__typename',
                    type: `'${contentType.cleanName}'`,
                    isReadonly: true,
                    hasQuestionToken: true,
                },
                { name: 'id', type: 'number' },
                { name: 'documentId', type: 'string' },
                { name: 'createdAt', type: 'string' },
                { name: 'updatedAt', type: 'string' },
                ...contentType.attributes.map(attr => ({
                    name: attr.name,
                    type: this.transformer.toTypeScript(
                        attr.type,
                        attr.required,
                    ),
                })),
            ],
        })
    }

    private addInputTypeInterface(
        sf: SourceFile,
        contentType: ContentType,
    ): void {
        sf.addInterface({
            name: `${contentType.cleanName}Input`,
            docs: [`Input type for creating/updating ${contentType.cleanName}`],
            isExported: true,
            properties: [
                ...contentType.attributes.map(attr => ({
                    name: attr.name,
                    type: this.transformer.toTypeScript(attr.type, false),
                    hasQuestionToken: true,
                })),
                ...contentType.media.map(mediaField => ({
                    name: mediaField.name,
                    type: `${mediaField.multiple ? 'number[]' : 'number'} | null`,
                    hasQuestionToken: true,
                })),
                ...contentType.relations.map(rel => {
                    const isArray =
                        rel.relationType === 'oneToMany' ||
                        rel.relationType === 'manyToMany'
                    return {
                        name: rel.name,
                        type: `${isArray ? 'number[]' : 'number'} | null`,
                        hasQuestionToken: true,
                    }
                }),
                ...contentType.components.map(compField => {
                    const compType = compField.repeatable
                        ? `${compField.componentType}Input[]`
                        : `${compField.componentType}Input`
                    return {
                        name: compField.name,
                        type: `${compType} | null`,
                        hasQuestionToken: true,
                    }
                }),
                ...contentType.dynamicZones.map(dzField => ({
                    name: dzField.name,
                    type: `(${dzField.componentTypes.map(ct => `${ct}Input`).join(' | ')})[] | null`,
                    hasQuestionToken: true,
                })),
            ],
        })
    }

    private addPopulateParams(sf: SourceFile, schema: ParsedSchema): void {
        sf.addStatements([
            '// ============================================',
            '// PopulateParam types for type-safe populate',
            '// ============================================',
        ])

        // Generate for components with populatable fields
        for (const component of schema.components) {
            const typeBody = this.buildPopulateParamTypeBody(component)
            if (typeBody) {
                sf.addTypeAlias({
                    name: `${component.cleanName}PopulateParam`,
                    isExported: true,
                    type: typeBody,
                })
            }
        }

        // Generate for content types with populatable fields
        for (const contentType of schema.contentTypes) {
            const typeBody = this.buildPopulateParamTypeBody(contentType)
            if (typeBody) {
                sf.addTypeAlias({
                    name: `${contentType.cleanName}PopulateParam`,
                    isExported: true,
                    type: typeBody,
                })
            }
        }
    }

    private buildPopulateParamTypeBody(
        type: ContentType | Component,
    ): string | null {
        const fields: string[] = []

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
            fields.push(`  ${rel.name}?: true | { ${options.join('; ')} }`)
        }

        for (const media of type.media) {
            fields.push(
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
            fields.push(`  ${comp.name}?: true | { ${options.join('; ')} }`)
        }

        for (const dz of type.dynamicZones) {
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
            fields.push(
                `  ${dz.name}?: true | { on?: { ${onEntries.join('; ')} } }`,
            )
        }

        if (fields.length === 0) return null

        return `{\n${fields.join('\n')}\n}`
    }

    private addPayloadUtilityTypes(sf: SourceFile, schema: ParsedSchema): void {
        sf.addStatements(`// Prisma-like Payload types for populate support
// These types allow type-safe population of relations
//
// Usage example:
// type ItemWithCategory = ItemGetPayload<{ populate: { category: true } }>
// const items = await strapi.items.find({ populate: { category: true } }) as ItemWithCategory[]
//
// This ensures that relations are only included in the type when populate is used`)

        // Generate GetPayload type for each component with populatable fields
        for (const component of schema.components) {
            if (this.hasAnyPopulatableFields(component)) {
                sf.addStatements(this.buildGetPayloadType(component))
            }
        }

        // Generate GetPayload type for each content type with populatable fields
        for (const contentType of schema.contentTypes) {
            if (this.hasAnyPopulatableFields(contentType)) {
                sf.addStatements(this.buildGetPayloadType(contentType))
            }
        }
    }

    private buildGetPayloadType(type: ContentType | Component): string {
        const name = type.cleanName

        if (!this.hasAnyPopulatableFields(type)) {
            return `export type ${name}GetPayload<P extends { populate?: any } = {}> = ${name} & {}`
        }

        const allPopFields = this.buildAllPopulatedFields(type)
        const arrayPopFields = this.buildArrayPopulatedFields(type)
        const perFieldPop = this.buildPerFieldPopulate(type)

        return `// Payload type for ${name} with populate support
export type ${name}GetPayload<P extends { populate?: any } = {}> =
  ${name} &
  (P extends { populate: infer Pop }
    ? Pop extends '*' | true
      ? {
${allPopFields}
        }
      : Pop extends readonly (infer _)[]
        ? {
${arrayPopFields}
          }
        : {
${perFieldPop}
          }
    : {})`
    }

    /**
     * Build fields for populate: '*' | true — all populatable fields with base types
     */
    private buildAllPopulatedFields(type: ContentType | Component): string {
        const fields: string[] = []

        for (const rel of type.relations) {
            const isNullable =
                rel.relationType === 'oneToOne' ||
                rel.relationType === 'manyToOne'
            const isArray =
                rel.relationType === 'oneToMany' ||
                rel.relationType === 'manyToMany'
            const nullSuffix = isNullable ? ' | null' : ''
            const arraySuffix = isArray ? '[]' : ''
            fields.push(
                `          ${rel.name}?: ${rel.targetType}${arraySuffix}${nullSuffix}`,
            )
        }

        for (const mediaField of type.media) {
            const mediaType = mediaField.multiple ? 'MediaFile[]' : 'MediaFile'
            fields.push(`          ${mediaField.name}?: ${mediaType}`)
        }

        for (const componentField of type.components) {
            const arraySuffix = componentField.repeatable ? '[]' : ''
            fields.push(
                `          ${componentField.name}?: ${componentField.componentType}${arraySuffix}`,
            )
        }

        for (const dzField of type.dynamicZones) {
            const unionType = dzField.componentTypes.join(' | ')
            fields.push(`          ${dzField.name}?: (${unionType})[]`)
        }

        return fields.join('\n')
    }

    /**
     * Build fields for array-style populate (e.g. populate: ['category', 'image'])
     */
    private buildArrayPopulatedFields(type: ContentType | Component): string {
        const fields: string[] = []

        for (const rel of type.relations) {
            const isNullable =
                rel.relationType === 'oneToOne' ||
                rel.relationType === 'manyToOne'
            const isArray =
                rel.relationType === 'oneToMany' ||
                rel.relationType === 'manyToMany'
            const nullSuffix = isNullable ? ' | null' : ''
            const arraySuffix = isArray ? '[]' : ''
            fields.push(
                `            ${rel.name}?: '${rel.name}' extends Pop[number] ? ${rel.targetType}${arraySuffix}${nullSuffix} : never`,
            )
        }

        for (const mediaField of type.media) {
            const mediaType = mediaField.multiple ? 'MediaFile[]' : 'MediaFile'
            fields.push(
                `            ${mediaField.name}?: '${mediaField.name}' extends Pop[number] ? ${mediaType} : never`,
            )
        }

        for (const componentField of type.components) {
            const arraySuffix = componentField.repeatable ? '[]' : ''
            fields.push(
                `            ${componentField.name}?: '${componentField.name}' extends Pop[number] ? ${componentField.componentType}${arraySuffix} : never`,
            )
        }

        for (const dzField of type.dynamicZones) {
            const unionType = dzField.componentTypes.join(' | ')
            fields.push(
                `            ${dzField.name}?: '${dzField.name}' extends Pop[number] ? (${unionType})[] : never`,
            )
        }

        return fields.join('\n')
    }

    /**
     * Build per-field conditional populate for object-style populate params
     */
    private buildPerFieldPopulate(type: ContentType | Component): string {
        const fields: string[] = []

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

            const resolvedType = hasPopulate
                ? `_ApplyFields<Pop['${rel.name}'] extends { populate: infer NestedPop } ? ${baseType}GetPayload<{ populate: NestedPop }> : ${baseType}, ${baseType}, Pop['${rel.name}']>${arraySuffix}${nullSuffix}`
                : `_ApplyFields<${baseType}, ${baseType}, Pop['${rel.name}']>${arraySuffix}${nullSuffix}`

            fields.push(
                `          ${rel.name}?: '${rel.name}' extends keyof Pop\n            ? ${resolvedType}\n            : never`,
            )
        }

        for (const mediaField of type.media) {
            const arraySuffix = mediaField.multiple ? '[]' : ''
            fields.push(
                `          ${mediaField.name}?: '${mediaField.name}' extends keyof Pop ? _ApplyFields<MediaFile, MediaFile, Pop['${mediaField.name}']>${arraySuffix} : never`,
            )
        }

        for (const componentField of type.components) {
            const baseType = componentField.componentType
            const arraySuffix = componentField.repeatable ? '[]' : ''
            const hasPopulate = this.hasPopulatableFields(baseType)

            const resolvedType = hasPopulate
                ? `_ApplyFields<Pop['${componentField.name}'] extends { populate: infer NestedPop } ? ${baseType}GetPayload<{ populate: NestedPop }> : ${baseType}, ${baseType}, Pop['${componentField.name}']>${arraySuffix}`
                : `_ApplyFields<${baseType}, ${baseType}, Pop['${componentField.name}']>${arraySuffix}`

            fields.push(
                `          ${componentField.name}?: '${componentField.name}' extends keyof Pop\n            ? ${resolvedType}\n            : never`,
            )
        }

        for (const dzField of type.dynamicZones) {
            const unionType = dzField.componentTypes.join(' | ')
            const dzType = `(${unionType})[]`
            fields.push(
                `          ${dzField.name}?: '${dzField.name}' extends keyof Pop ? ${dzType} : never`,
            )
        }

        return fields.join('\n')
    }

    private hasAnyPopulatableFields(type: ContentType | Component): boolean {
        return (
            type.relations.length > 0 ||
            type.media.length > 0 ||
            type.components.length > 0 ||
            type.dynamicZones.length > 0
        )
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
            return this.hasAnyPopulatableFields(contentType)
        }

        // Check in components
        const component = this.schema.components.find(
            comp => comp.cleanName === typeName,
        )
        if (component) {
            return this.hasAnyPopulatableFields(component)
        }

        return false
    }
}
