# Type Mapping

This page is a comprehensive reference for how Strapi schema types are converted to TypeScript types during code generation.

## Scalar Type Mapping

| Strapi Type  | TypeScript Type | Notes                                |
| ------------ | --------------- | ------------------------------------ |
| `string`     | `string`        | Short text field                     |
| `text`       | `string`        | Long text field                      |
| `richtext`   | `string`        | Markdown rich text (Strapi v4 style) |
| `email`      | `string`        | Email field                          |
| `uid`        | `string`        | Unique identifier field              |
| `integer`    | `number`        |                                      |
| `biginteger` | `number`        |                                      |
| `float`      | `number`        |                                      |
| `decimal`    | `number`        |                                      |
| `boolean`    | `boolean`       |                                      |
| `date`       | `string`        | ISO date string (`YYYY-MM-DD`)       |
| `datetime`   | `string`        | ISO datetime string                  |
| `time`       | `string`        | Time string (`HH:mm:ss`)             |
| `json`       | `unknown`       | Arbitrary JSON data                  |

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

In input types, relations are always referenced by ID:

| Relation Type | Input TypeScript Type |
| ------------- | --------------------- |
| `oneToOne`    | `number \| null`      |
| `manyToOne`   | `number \| null`      |
| `oneToMany`   | `number[]`            |
| `manyToMany`  | `number[]`            |

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

| Field / Attribute            | Reason                                        |
| ---------------------------- | --------------------------------------------- |
| `createdBy`                  | Admin-only field                              |
| `updatedBy`                  | Admin-only field                              |
| `publishedAt`                | Managed by Strapi internally                  |
| `locale`                     | i18n internal field                           |
| `localizations`              | i18n internal field                           |
| `password`                   | Private attribute                             |
| Admin relations (`admin::*`) | Admin panel internals                         |
| Non-user plugin relations    | Plugin internals (except `users-permissions`) |

::: tip
Any attribute marked as `private` in the Strapi schema is automatically excluded from generated types. The `password` type is the most common example.
:::

## Nullable and Optional Behavior

Nullability depends on the `required` setting in your Strapi schema and the type category:

### Base Types (reading)

- **Required fields** are generated as their plain type (e.g., `title: string`).
- **Non-required fields** are generated with `| null` (e.g., `description: string | null`).
- Relations already encode nullability in their type (`| null` for singular, `[]` for plural).

### Input Types (writing)

- **All fields** are optional (`?:`) because input types are used for both create and partial update operations.
- Scalar fields use `| null` to allow clearing a value (e.g., `title?: string | null`).
- Relation fields accept IDs: `category?: number | null` or `tags?: number[]`.
- Media fields accept IDs: `avatar?: number | null` or `gallery?: number[]`.
- Component fields accept objects: `seo?: SeoComponentInput | null`.

```ts
// All input fields are optional for partial updates
interface ArticleInput {
    title?: string | null
    body?: string | null
    category?: number | null // relation by ID
    cover?: number | null // media by ID
    seo?: SeoComponentInput | null // component as object
    tags?: number[] // many relation by IDs
}
```
