import type {
    Attribute,
    Component,
    ContentType,
    ParsedSchema,
} from '../schema-types.js'
import {
    dzComponentUids,
    inputFields,
    type InputField,
    type InputMode,
} from './input-fields.js'

/** First line of every validation file — only files carrying it are ours to overwrite or delete. */
export const VALIDATION_FILE_MARKER = '// Auto-generated Strapi validators'

const MODES: readonly InputMode[] = ['Create', 'Update']

// Strapi checks email and time formats itself; these accept everything it accepts
const EMAIL_PATTERN = String.raw`^[^\s@]+@[^\s@]+\.[^\s@]+$`
const TIME_PATTERN = String.raw`^\d{2}:\d{2}:\d{2}(\.\d{1,3})?$`
const BIGINT_PATTERN = String.raw`^-?\d+$`

/** Renders the pieces of a validator file; one implementation per validation library. */
export interface ValidatorEmitter {
    header(): string
    shared(): string
    attribute(attr: Attribute): string
    field(field: InputField, mode: InputMode): string
    object(name: string, fields: string[]): string
    dzVariant(name: string, base: string, uid: string): string
}

const regex = (source: string): string =>
    `new RegExp(${JSON.stringify(source)})`

export class ZodEmitter implements ValidatorEmitter {
    header(): string {
        return `${VALIDATION_FILE_MARKER}
// Do not edit manually
/* eslint-disable */
import { z } from 'zod'
import type { BlocksContent } from './types.js'
`
    }

    shared(): string {
        return `export const StrapiIDSchema = z.union([z.string(), z.number()])

export const RelationPositionSchema = z.strictObject({
  before: StrapiIDSchema.optional(),
  after: StrapiIDSchema.optional(),
  start: z.literal(true).optional(),
  end: z.literal(true).optional(),
})

export const RelationRefSchema = z.strictObject({
  documentId: z.string().optional(),
  id: z.number().optional(),
  locale: z.string().nullable().optional(),
  status: z.enum(['draft', 'published']).optional(),
  position: RelationPositionSchema.optional(),
})

const RelationTargetSchema = z.union([StrapiIDSchema, RelationRefSchema])

export const RelationInputSchema = z.union([
  StrapiIDSchema,
  RelationRefSchema,
  z.array(RelationTargetSchema),
  z.strictObject({
    connect: z.array(RelationTargetSchema).optional(),
    disconnect: z.array(RelationTargetSchema).optional(),
    set: z.array(RelationTargetSchema).optional(),
  }),
  z.null(),
])

export const MediaInputSchema = StrapiIDSchema.nullable()

export const MultiMediaInputSchema = z.array(StrapiIDSchema).nullable()
`
    }

    attribute(attr: Attribute): string {
        const c = attr.constraints ?? {}
        const lengths = (base: string): string =>
            base +
            (c.minLength !== undefined ? `.min(${c.minLength})` : '') +
            (c.maxLength !== undefined ? `.max(${c.maxLength})` : '')
        const bounds = (base: string): string =>
            base +
            (c.min !== undefined ? `.min(${c.min})` : '') +
            (c.max !== undefined ? `.max(${c.max})` : '')

        switch (attr.type.kind) {
            case 'string':
            case 'text':
            case 'richtext': {
                const base = lengths('z.string()')
                if (c.regex === undefined) return base
                const matched = `${base}.regex(${regex(c.regex)})`
                // Strapi skips the pattern for "" on an optional field, but not minLength
                return attr.required || (c.minLength ?? 0) > 0
                    ? matched
                    : `z.union([z.literal(''), ${matched}])`
            }
            case 'email':
                return `${lengths('z.string()')}.regex(${regex(EMAIL_PATTERN)})`
            case 'password':
                return lengths('z.string()')
            case 'blocks':
                return 'z.custom<BlocksContent>(value => Array.isArray(value))'
            case 'integer':
                return bounds('z.number().int()')
            case 'biginteger':
                return `z.union([z.string().regex(${regex(BIGINT_PATTERN)}), z.number().int()])`
            case 'float':
            case 'decimal':
                return bounds('z.number()')
            case 'boolean':
                return 'z.boolean()'
            case 'date':
            case 'datetime':
                return 'z.string()'
            case 'time':
                return `z.string().regex(${regex(TIME_PATTERN)})`
            case 'json':
                return 'z.unknown()'
            case 'enumeration':
                return attr.type.values.length > 0
                    ? `z.enum([${attr.type.values.map(v => JSON.stringify(v)).join(', ')}])`
                    : 'z.never()'
            default:
                return 'z.unknown()'
        }
    }

    field(field: InputField, mode: InputMode): string {
        let schema: string
        switch (field.kind) {
            case 'id':
                schema = 'z.number()'
                break
            case 'attribute':
                schema = this.attribute(field.attr)
                if (field.nullable) schema += '.nullable()'
                break
            case 'media':
                schema = field.multiple
                    ? 'MultiMediaInputSchema'
                    : 'MediaInputSchema'
                break
            case 'relation':
                schema = 'RelationInputSchema'
                break
            case 'component': {
                const inner = `${field.componentType}${mode}InputSchema`
                schema = field.repeatable
                    ? `z.array(${inner})`
                    : field.nullable
                      ? `${inner}.nullable()`
                      : inner
                break
            }
            case 'dynamiczone': {
                const members = field.componentTypes.map(
                    ct => `${ct}Dz${mode}InputSchema`,
                )
                schema = `z.array(z.discriminatedUnion('__component', [${members.join(', ')}]))`
                break
            }
            case 'locale':
                schema = 'z.string()'
                break
            case 'publishedAt':
                schema = 'z.string().nullable()'
                break
        }
        if (field.optional) schema += '.optional()'
        return `  ${JSON.stringify(field.name)}: ${schema},`
    }

    // Strapi answers 400 "Invalid key" to any key it does not know, at every level
    object(name: string, fields: string[]): string {
        return `export const ${name} = z.strictObject({\n${fields.join('\n')}\n})\n`
    }

    dzVariant(name: string, base: string, uid: string): string {
        return `export const ${name} = ${base}.extend({ __component: z.literal(${JSON.stringify(uid)}) })\n`
    }
}

export class ValidationGenerator {
    constructor(
        private readonly emitter: ValidatorEmitter = new ZodEmitter(),
    ) {}

    generate(schema: ParsedSchema): string {
        const out = [this.emitter.header(), this.emitter.shared()]
        const dzUids = dzComponentUids(schema)

        for (const component of componentsInDependencyOrder(schema)) {
            for (const mode of MODES) {
                const name = `${component.cleanName}${mode}InputSchema`
                out.push(this.objectFor(component, mode, false, name))
                if (dzUids.has(component.uid)) {
                    out.push(
                        this.emitter.dzVariant(
                            `${component.cleanName}Dz${mode}InputSchema`,
                            name,
                            component.uid,
                        ),
                    )
                }
            }
        }
        for (const contentType of schema.contentTypes) {
            for (const mode of MODES) {
                out.push(
                    this.objectFor(
                        contentType,
                        mode,
                        true,
                        `${contentType.cleanName}${mode}InputSchema`,
                    ),
                )
            }
        }

        return out.join('\n')
    }

    private objectFor(
        type: ContentType | Component,
        mode: InputMode,
        isContentType: boolean,
        name: string,
    ): string {
        const fields = inputFields(type, mode, isContentType).map(field =>
            this.emitter.field(field, mode),
        )
        return this.emitter.object(name, fields)
    }
}

// A schema constant must be declared before any schema that nests it
function componentsInDependencyOrder(schema: ParsedSchema): Component[] {
    const byName = new Map(schema.components.map(c => [c.cleanName, c]))
    const ordered: Component[] = []
    const state = new Map<string, 'visiting' | 'done'>()

    const visit = (component: Component): void => {
        const seen = state.get(component.cleanName)
        if (seen === 'done') return
        if (seen === 'visiting') {
            throw new Error(
                `Component ${component.uid} nests itself; Strapi does not allow component cycles`,
            )
        }
        state.set(component.cleanName, 'visiting')
        const nested = [
            ...component.components.map(c => c.componentType),
            ...component.dynamicZones.flatMap(dz => dz.componentTypes),
        ]
        for (const name of nested) {
            const dep = byName.get(name)
            if (dep) visit(dep)
        }
        state.set(component.cleanName, 'done')
        ordered.push(component)
    }

    for (const component of schema.components) visit(component)
    return ordered
}
