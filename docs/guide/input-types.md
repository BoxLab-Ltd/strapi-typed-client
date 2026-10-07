# Input Types

`strapi-typed-client` generates separate input types for create and update operations. These types reflect what Strapi expects when writing data, which differs from what it returns when reading.

## Base Type vs Input Type

When you read data from Strapi, you get the full entity with all computed and populated fields:

```ts
// Reading — base type (Article)
{
  id: number
  documentId: string
  title: string
  content: string
  category: { id: number; documentId: string } | null
  tags: { id: number; documentId: string }[]
  coverImage: { id: number; url: string; ... } | null
  createdAt: string
  updatedAt: string
}
```

When you write data, you use the input types — `ArticleCreateInput` for `create()` and `ArticleUpdateInput` for `update()` — where relations and media are referenced by ID:

```ts
// Writing — ArticleCreateInput
{
  title: string                   // required in the schema
  content?: string | null
  category?: RelationInput        // relation — id, documentId, reference object, array, or { connect | disconnect | set }
  tags?: RelationInput            // relation (any cardinality)
  coverImage?: MediaInput         // media — file id
  locale?: string
  publishedAt?: string | null
}
```

## Create vs Update

Both input types follow what a live Strapi 5 accepts, field by field:

| Field                                   | `*CreateInput`                                               | `*UpdateInput`         |
| --------------------------------------- | ------------------------------------------------------------ | ---------------------- |
| Required scalar                         | required, never `null`                                       | optional, never `null` |
| Required scalar with a schema `default` | optional — Strapi applies the default — never `null`         | optional, never `null` |
| Optional scalar                         | optional, accepts `null`                                     | same                   |
| Relation / media                        | always optional — Strapi does not enforce `required` on them | same                   |
| Required single component               | required, never `null`                                       | optional, never `null` |
| Optional single component               | optional, accepts `null`                                     | same                   |
| Repeatable component / dynamic zone     | optional, **never `null`** — send `[]` to clear              | same                   |
| Private and `password` fields           | accepted on write, never present on the read type            | same                   |
| `locale`, `publishedAt` (content types) | optional                                                     | optional               |

Keys Strapi does not know — including `id`, `documentId`, `createdAt` or `createdBy` — are rejected by Strapi with `400 Invalid key`, so the input types do not carry them.

## Relations

In input types, every relation — regardless of cardinality — is typed as `RelationInput`:

```ts
type StrapiID = string | number

type RelationRef = {
    documentId?: string
    id?: number
    locale?: string | null // target a localized version
    status?: 'draft' | 'published' // target the draft or published version
    position?: { before?: StrapiID; after?: StrapiID; start?: true; end?: true }
}

type RelationInput =
    | StrapiID // a single id or documentId
    | RelationRef // a single reference object
    | (StrapiID | RelationRef)[] // an array of either
    | {
          connect?: (StrapiID | RelationRef)[]
          disconnect?: (StrapiID | RelationRef)[]
          set?: (StrapiID | RelationRef)[]
      }
    | null
```

| Relation Type | Input Type      |
| ------------- | --------------- |
| One-to-one    | `RelationInput` |
| Many-to-one   | `RelationInput` |
| One-to-many   | `RelationInput` |
| Many-to-many  | `RelationInput` |

A plain id or array is shorthand for `set` — it overwrites the existing relations. Use the explicit `{ connect | disconnect | set }` form for fine-grained updates.

```ts
await strapi.articles.create({
    title: 'New Article',
    category: 5, // link to category with id 5
    tags: [1, 3, 7], // set tags to ids 1, 3, 7
})

// Fine-grained update without overwriting the whole list
await strapi.articles.update('abc123', {
    tags: { connect: [9], disconnect: [3] },
})
```

## Media

Single-media fields are typed `MediaInput` (`StrapiID | null`); multi-media fields are `MultiMediaInput` (`StrapiID[] | null`). Both reference an already-uploaded file by its numeric id:

```ts
await strapi.articles.create({
    title: 'New Article',
    coverImage: 12, // single media — file id 12
    gallery: [12, 15, 20], // multi media — array of file ids
})
```

::: info
File uploads are handled separately through Strapi's upload API. The input type only accepts the id of an existing media entry.
:::

## Components as Objects

Component fields in input types accept plain objects matching the component's input shape:

```ts
await strapi.articles.create({
    title: 'New Article',
    seo: {
        metaTitle: 'Article about TypeScript',
        metaDescription: 'A deep dive into type safety.',
        keywords: 'typescript, strapi, types',
    },
})
```

Repeatable components accept an array of objects:

```ts
await strapi.articles.create({
    title: 'New Article',
    sections: [
        { heading: 'Introduction', body: '...' },
        { heading: 'Conclusion', body: '...' },
    ],
})
```

## Partial Updates

For `update()`, all fields in the input type are optional. This allows partial updates where you only send the fields that changed:

```ts
// Only update the title — all other fields remain unchanged
await strapi.articles.update('abc123', {
    title: 'Updated Title',
})

// Clear a relation by setting it to null
await strapi.articles.update('abc123', {
    category: null,
})

// Replace all tags
await strapi.articles.update('abc123', {
    tags: [2, 4, 6],
})
```

## Nullable Fields

Fields that are not required in your Strapi schema accept `null` in the input type (repeatable components and dynamic zones excepted — Strapi rejects `null` there, send `[]` instead):

```ts
await strapi.articles.create({
    title: 'Article', // required — cannot be null
    subtitle: null, // optional — can be null
    category: null, // relation — can be null
    coverImage: null, // media — can be null
})
```

## Full Create Example

Here is a complete example creating an article with all field types:

```ts
const result = await strapi.articles.create({
    // Scalar fields
    title: 'Getting Started with Strapi v5',
    slug: 'getting-started-strapi-v5',
    content: 'Full article content here...',
    views: 0,
    featured: true,
    publishedAt: '2025-01-15T10:00:00.000Z',

    // Relations (as IDs)
    category: 3,
    tags: [1, 5, 12],
    author: 7,

    // Media (as ID)
    coverImage: 42,

    // Component
    seo: {
        metaTitle: 'Getting Started with Strapi v5',
        metaDescription: 'Learn how to use Strapi v5 with TypeScript.',
    },

    // Repeatable component
    sections: [
        { heading: 'Introduction', body: 'Welcome...' },
        { heading: 'Setup', body: 'First, install...' },
    ],
})
```

::: tip
The generated input types give you full autocomplete, so you do not need to memorize field names or types. Your editor will show you exactly what fields are available and what types they expect.
:::

## Validation Constraints

Constraints declared in your Strapi schema (`min`, `max`, `minLength`, `maxLength`, `regex`, `default`) are surfaced as JSDoc tags on both the base type and the input type. Your editor shows them on hover and in autocomplete, so the rules live next to the field:

```ts
export interface ArticleCreateInput {
    /**
     * @minLength 3
     * @maxLength 120
     */
    title?: string | null
    /** @pattern ^[a-z0-9-]+$ */
    slug?: string | null
    /**
     * @minimum 0
     * @maximum 100
     */
    discount?: number | null
    /** @default "draft" */
    status?: 'draft' | 'published' | null
}
```

The tags follow the [ts-to-zod](https://github.com/fabien0102/ts-to-zod) / TypeDoc convention, so downstream tooling can read them too:

| Strapi schema | JSDoc tag    |
| ------------- | ------------ |
| `min`         | `@minimum`   |
| `max`         | `@maximum`   |
| `minLength`   | `@minLength` |
| `maxLength`   | `@maxLength` |
| `regex`       | `@pattern`   |
| `default`     | `@default`   |

::: info
These tags are informational — they document the schema in your editor and for tooling. To enforce them at runtime, generate the [Zod validators](#runtime-validation-zod).
:::

## Default Values

For every content type and component that declares schema defaults, a `*Defaults` constant is generated. Each holds only the fields that have a `default` in the schema, typed `as const satisfies Partial<*CreateInput>`:

```ts
export const ArticleDefaults = {
    status: 'draft',
    featured: false,
    views: 0,
} as const satisfies Partial<ArticleCreateInput>
```

Use it as a single source of truth for form seeds — the same defaults the server would apply:

```ts
import { ArticleDefaults } from './strapi/types'

// Seed a create form straight from the schema
const [form, setForm] = useState({ ...ArticleDefaults })

await strapi.articles.create({ ...ArticleDefaults, title: 'New Article' })
```

Entities without any schema defaults get no constant — there is nothing to default.

For components used in a **dynamic zone**, an additional `*DzDefaults` constant carries the `__component` discriminator, ready to push as a new block:

```ts
import { HeroSectionDzDefaults } from './strapi/types'

// HeroSectionDzDefaults === { __component: 'sections.hero', ...defaults }
setBlocks(prev => [...prev, { ...HeroSectionDzDefaults }])
```

## Runtime Validation (Zod)

Pass `--validation zod` (or `validation: 'zod'` in [`withStrapiTypes`](/guide/nextjs)) and the generator also writes `validation.ts` next to the client: a [Zod 4](https://zod.dev) schema for every `*CreateInput` and `*UpdateInput`, components and dynamic-zone variants included. Install zod in your app first — it runs in your code, so it belongs in `dependencies`:

```bash
npm install zod
npx strapi-types generate --output ./src/strapi --validation zod
```

Later runs keep the mode already in `--output`; pass `--validation none` to turn it off (the generated `validation.*` files are removed).

```ts
import { ArticleCreateInputSchema } from './strapi/validation'

// A form resolver
const form = useForm({ resolver: zodResolver(ArticleCreateInputSchema) })

// A server action
export async function createArticle(input: unknown) {
    const parsed = ArticleCreateInputSchema.safeParse(input)
    if (!parsed.success) return { errors: parsed.error.issues }
    return strapi.articles.create(parsed.data)
}
```

| Export                                                      | Validates                                |
| ----------------------------------------------------------- | ---------------------------------------- |
| `ArticleCreateInputSchema`                                  | `ArticleCreateInput`                     |
| `ArticleUpdateInputSchema`                                  | `ArticleUpdateInput`                     |
| `SeoCreateInputSchema`, …                                   | component inputs                         |
| `HeroSectionDzCreateInputSchema`, …                         | dynamic-zone blocks (with `__component`) |
| `RelationInputSchema`, `MediaInputSchema`, `StrapiIDSchema` | shared building blocks                   |

**What a schema guarantees:**

- `z.input<typeof ArticleCreateInputSchema>` is exactly `ArticleCreateInput` — the two are generated from one field model and a test checks them against each other.
- It accepts what a live Strapi 5 accepts and rejects what Strapi answers with `400`: unknown keys at every level, `required`, `min`/`max`, `minLength`/`maxLength`, `regex` (skipped for `""` on an optional field, as Strapi does), enumerations, email and `HH:mm:ss` time formats, integer and biginteger shapes, and dynamic-zone `__component` values.
- Where Strapi coerces (`"5"` into an integer, `"true"` into a boolean), the schema follows the TS type and expects the real type.
- `parse()` never adds keys: schema defaults are not applied with `.default()` — Strapi applies them itself, and injecting them into an update would overwrite stored values. Use [`*Defaults`](#default-values) to seed forms.

::: info Drafts
The schemas validate at publish level. A request sent with `?status=draft` is validated more loosely by Strapi (it skips `required`, length and range checks), so a draft that Strapi would store can still fail the schema.
:::

::: tip Bundle size
`validation.ts` is not re-exported from the `index` barrel — importing the client never pulls zod into a bundle. Import the schemas from `./strapi/validation` where you need them.
:::
