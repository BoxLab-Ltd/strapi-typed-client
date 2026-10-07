# Type Mapping

This page is a comprehensive reference for how Strapi schema types are converted to TypeScript types during code generation.

## Scalar Type Mapping

| Strapi Type  | TypeScript Type | Notes                                                                             |
| ------------ | --------------- | --------------------------------------------------------------------------------- |
| `string`     | `string`        | Short text field                                                                  |
| `text`       | `string`        | Long text field                                                                   |
| `richtext`   | `string`        | Markdown rich text (Strapi v4 style)                                              |
| `email`      | `string`        | Email field                                                                       |
| `uid`        | `string`        | Unique identifier field                                                           |
| `integer`    | `number`        |                                                                                   |
| `biginteger` | `string`        | Strapi returns it as a string to keep precision; inputs accept `string \| number` |
| `float`      | `number`        |                                                                                   |
| `decimal`    | `number`        |                                                                                   |
| `boolean`    | `boolean`       |                                                                                   |
| `date`       | `string`        | ISO date string (`YYYY-MM-DD`)                                                    |
| `datetime`   | `string`        | ISO datetime string                                                               |
| `time`       | `string`        | Time string (`HH:mm:ss`)                                                          |
| `json`       | `unknown`       | Arbitrary JSON data                                                               |

## Complex Type Mapping

| Strapi Type                    | TypeScript Type             | Notes                                                               |
| ------------------------------ | --------------------------- | ------------------------------------------------------------------- |
| `enumeration<['a', 'b', 'c']>` | `'a' \| 'b' \| 'c'`         | Union of literal string types                                       |
| `blocks` (Rich Text v2)        | `BlocksContent`             | Structured block array; see [Media & Blocks](/reference/media-file) |
| `media` (single)               | `MediaFile \| null`         | See [MediaFile](/reference/media-file)                              |
| `media` (multiple)             | `MediaFile[]`               | Array of media objects                                              |
| `component` (single)           | `ComponentName`             | Typed interface for the component                                   |
| `component` (repeatable)       | `ComponentName[]`           | Array of component objects                                          |
| `dynamiczone`                  | `(CompA \| CompB \| ...)[]` | Union type array of all allowed components                          |
| `password`                     | excluded                    | Private fields are not generated                                    |

## Relation Mapping

Relations are mapped differently depending on whether they are populated or not.

### Base Types (without populate)

Relations are **not included** in base types. When you query without `populate`, Strapi does not return relation data, so the generated base interface only contains scalar fields.

### Populated Types (with populate)

When you use the `populate` parameter, the return type automatically includes the related entities:

| Relation Type | Populated TypeScript Type |
| ------------- | ------------------------- |
| `oneToOne`    | `RelatedType \| null`     |
| `manyToOne`   | `RelatedType \| null`     |
| `oneToMany`   | `RelatedType[]`           |
| `manyToMany`  | `RelatedType[]`           |

```ts
// Without populate — only scalar fields
const article = await strapi.articles.findOne('abc123')
// article: Article  (no relations)

// With populate — relations are included in the type
const article = await strapi.articles.findOne('abc123', {
    populate: { category: true, tags: true },
})
// article: Article & { category?: Category | null; tags?: Tag[] }
```

### Input Types (create/update)

In input types, every relation is typed as `RelationInput` (`StrapiID | RelationRef | (StrapiID | RelationRef)[] | RelationOperations | null`, where `StrapiID = string | number` and `RelationRef` is the `{ documentId?, id?, locale?, status?, position? }` object form). A plain id or array is shorthand for `set`; the explicit `{ connect | disconnect | set }` form is also accepted:

| Relation Type | Input TypeScript Type |
| ------------- | --------------------- |
| `oneToOne`    | `RelationInput`       |
| `manyToOne`   | `RelationInput`       |
| `oneToMany`   | `RelationInput`       |
| `manyToMany`  | `RelationInput`       |

## Base Fields

The following fields are automatically added to every generated content type interface:

| Field        | Type     | Description                   |
| ------------ | -------- | ----------------------------- |
| `id`         | `number` | Auto-incremented database ID  |
| `documentId` | `string` | Strapi v5 document identifier |
| `createdAt`  | `string` | ISO datetime of creation      |
| `updatedAt`  | `string` | ISO datetime of last update   |

Component types receive only `id: number` as a base field.

::: info
A readonly `__typename` field is also added to content type interfaces for nominal typing. This ensures TypeScript treats structurally similar types as distinct. You do not need to use this field directly.
:::

## Excluded Fields

The following fields from the Strapi schema are **not** included in generated types:

| Field / Attribute            | Reason                                            |
| ---------------------------- | ------------------------------------------------- |
| Admin relations (`admin::*`) | Admin panel internals (except the creator fields) |
| Non-user plugin relations    | Plugin internals (except `users-permissions`)     |

::: info i18n Fields
If your content type has the Strapi i18n plugin enabled, `locale` (string) and `localizations` (self-referencing relation) are **automatically included** in generated types. Content types without i18n are not affected.
:::

::: tip Private and password fields
Attributes marked `private`, and every `password` field, never appear on read types or filters — Strapi does not return them. Strapi does accept them on write, so they are present in the create/update input types.
:::

## Creator Fields

`createdBy` and `updatedBy` are generated **only for content types that opt in**, because that is exactly what Strapi does. Strapi adds both as relations to `admin::user` and marks them `private: !options.populateCreatorFields` — so with the option off they are stripped from every REST response.

Generating them regardless would be worse than noise: without the option Strapi rejects the request outright with `400 ValidationError: Invalid key createdBy`. A populate key the type system accepted would fail at runtime.

Enable the option in the content type's `schema.json`:

```json
{
    "options": {
        "draftAndPublish": true,
        "populateCreatorFields": true
    }
}
```

Regenerate, and both fields become populatable like any other relation:

```typescript
const articles = await strapi.articles.find({
    populate: { createdBy: true },
})

articles[0].createdBy?.firstname // string | null
```

They resolve to `AdminUser`, the sanitized shape Strapi returns — `id`, `documentId`, `firstname`, `lastname`, `username`, `preferedLanguage`, `createdAt`, `updatedAt`, `publishedAt`. The name avoids colliding with the users-permissions `User`. Admin `email`, `roles` and the token fields stay `private` in Strapi's own schema and are never sent, so they are absent from the type.

::: info
Strapi's own guide lists this shape without `documentId` and `publishedAt`. A live 5.44 backend returns both — the type follows the response, not the guide.
:::

Both fields are read-only: Strapi marks them `writable: false`, so they are populatable and filterable but never appear in `*CreateInput` / `*UpdateInput`.

::: info Plugin upgrade required
This is decided inside Strapi, by the plugin that exposes your schema. Updating only the CLI is not enough — the plugin in your Strapi instance has to be new enough to forward the fields.
:::

## Nullable and Optional Behavior

Nullability depends on the `required` setting in your Strapi schema and the type category:

### Base Types (reading)

- **Required fields** are generated as their plain type (e.g., `title: string`).
- **Non-required fields** are generated with `| null` (e.g., `description: string | null`).
- Relations already encode nullability in their type (`| null` for singular, `[]` for plural).

### Input Types (writing)

- `*CreateInput` requires the fields Strapi requires on create (a required field with a schema `default` stays optional — Strapi fills it in); `*UpdateInput` makes every key optional.
- Non-required scalars accept `null` to clear a value; repeatable components and dynamic zones do not (send `[]`).
- Relation fields are typed `RelationInput`, media fields `MediaInput` / `MultiMediaInput`, components their `*CreateInput` / `*UpdateInput`.

```ts
interface ArticleCreateInput {
    title: string // required
    body?: string | null
    category?: RelationInput // relation (id, documentId, reference object, array, or operations)
    cover?: MediaInput // media by id
    seo?: SeoCreateInput | null // component as object
    tags?: RelationInput // relation (any cardinality)
}
```

See [Input Types](/guide/input-types#create-vs-update) for the full rules and the optional [Zod validators](/guide/input-types#runtime-validation-zod).
