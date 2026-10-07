import type {
    Attribute,
    Component,
    ContentType,
    ParsedSchema,
} from '../schema-types.js'

export type InputMode = 'Create' | 'Update'

// TS inputs and Zod schemas both render from this, so they cannot disagree on keys, optionality or null
export type InputField = { name: string; optional: boolean } & (
    | { kind: 'id' }
    | { kind: 'attribute'; attr: Attribute; nullable: boolean }
    | { kind: 'media'; multiple: boolean }
    | { kind: 'relation' }
    | {
          kind: 'component'
          componentType: string
          repeatable: boolean
          nullable: boolean
      }
    | { kind: 'dynamiczone'; componentTypes: string[] }
    | { kind: 'locale' }
    | { kind: 'publishedAt' }
)

// Each rule mirrors what a live Strapi 5 accepts on create/update (see input-types docs)
export function inputFields(
    type: ContentType | Component,
    mode: InputMode,
    isContentType: boolean,
): InputField[] {
    const update = mode === 'Update'
    const fields: InputField[] = []

    if (!isContentType) fields.push({ name: 'id', optional: true, kind: 'id' })

    for (const attr of type.attributes) {
        // Strapi applies a schema default before checking `required`
        const hasDefault =
            attr.defaultValue !== undefined && attr.defaultValue !== null
        fields.push({
            name: attr.name,
            optional: update || !attr.required || hasDefault,
            kind: 'attribute',
            attr,
            nullable: !attr.required,
        })
    }
    for (const media of type.media) {
        fields.push({
            name: media.name,
            optional: true,
            kind: 'media',
            multiple: media.multiple,
        })
    }
    // Strapi-managed relations (the creator fields) are readable but never writable
    for (const rel of type.relations) {
        if (rel.readOnly) continue
        fields.push({ name: rel.name, optional: true, kind: 'relation' })
    }
    // Strapi rejects null for repeatable components and dynamic zones, and
    // enforces `required` on a single component (unlike relations/media).
    for (const comp of type.components) {
        const required = comp.required && !comp.repeatable
        fields.push({
            name: comp.name,
            optional: update || !required,
            kind: 'component',
            componentType: comp.componentType,
            repeatable: comp.repeatable,
            nullable: !comp.repeatable && !required,
        })
    }
    for (const dz of type.dynamicZones) {
        fields.push({
            name: dz.name,
            optional: true,
            kind: 'dynamiczone',
            componentTypes: dz.componentTypes,
        })
    }
    // i18n content types already carry `locale` as an attribute
    const taken = new Set(fields.map(f => f.name))
    if (isContentType && !taken.has('locale')) {
        fields.push({ name: 'locale', optional: true, kind: 'locale' })
    }
    if (isContentType && !taken.has('publishedAt')) {
        fields.push({
            name: 'publishedAt',
            optional: true,
            kind: 'publishedAt',
        })
    }

    return fields
}

/** UIDs of the components used inside any dynamic zone. */
export function dzComponentUids(schema: ParsedSchema): Set<string> {
    const uids = new Set<string>()
    for (const owner of [...schema.contentTypes, ...schema.components]) {
        for (const dz of owner.dynamicZones) {
            for (const uid of dz.components) uids.add(uid)
        }
    }
    return uids
}
