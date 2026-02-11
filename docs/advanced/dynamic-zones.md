# Dynamic Zones

Dynamic Zones are one of Strapi's most powerful features, allowing content editors to compose pages from a set of predefined components. `strapi-typed-client` fully supports Dynamic Zones with generated union types, enabling type-safe access to heterogeneous content blocks.

## Generated Types

When your Strapi schema includes a Dynamic Zone field, the generator produces a union type of all possible components for that zone. Each component in the union includes a `__component` string literal field that acts as a discriminant.

For example, given a `Landing` content type with a `content` Dynamic Zone that allows `HeroBlock`, `TextBlock`, and `GalleryBlock` components:

```typescript
// Generated output in types.ts

export interface HeroBlock {
    __component: 'landing.hero-block'
    heading: string
    subheading: string | null
    backgroundImage: StrapiMedia | null
}

export interface TextBlock {
    __component: 'landing.text-block'
    body: string
    alignment: 'left' | 'center' | 'right'
}

export interface GalleryBlock {
    __component: 'landing.gallery-block'
    title: string | null
    images: StrapiMedia[]
}

export interface Landing {
    id: number
    documentId: string
    title: string
    content: (HeroBlock | TextBlock | GalleryBlock)[] | null
    createdAt: string
    updatedAt: string
}
```

The Dynamic Zone field is always typed as an array of the component union, or `null` if the zone has no blocks.

## Loading Dynamic Zone Content

Dynamic Zone fields are **not populated by default** in Strapi responses. You must explicitly populate them to receive the component data:

```typescript
const landing = await strapi.landing.find({
    populate: {
        content: true,
    },
})
```

For nested relations within Dynamic Zone components, use deep populate:

```typescript
const landing = await strapi.landing.find({
    populate: {
        content: {
            populate: {
                backgroundImage: true, // populate media inside HeroBlock
                images: true, // populate media inside GalleryBlock
            },
        },
    },
})
```

::: warning
Without populating the Dynamic Zone field, it will be `null` in the response even if the entry has blocks configured in Strapi.
:::

## Type Narrowing

Since each component carries a `__component` string literal, you can use it as a discriminant to narrow the union type.

### Using the `__component` field

The most reliable approach is to check the `__component` field directly:

```typescript
const landing = await strapi.landing.find({
    populate: { content: true },
})

if (landing.data?.content) {
    for (const block of landing.data.content) {
        switch (block.__component) {
            case 'landing.hero-block':
                // TypeScript knows `block` is HeroBlock here
                console.log(block.heading, block.subheading)
                break

            case 'landing.text-block':
                // TypeScript knows `block` is TextBlock here
                console.log(block.body, block.alignment)
                break

            case 'landing.gallery-block':
                // TypeScript knows `block` is GalleryBlock here
                console.log(block.title, block.images.length)
                break
        }
    }
}
```

### Using property checks

You can also narrow using `in` checks on unique properties, though this is less precise:

```typescript
if ('heading' in block) {
    // block is narrowed to HeroBlock (if `heading` is unique to it)
    console.log(block.heading)
}
```

::: tip
Prefer `__component` checks over property checks. The `__component` field is always present and guaranteed to be unique, whereas property names may overlap across components.
:::

### Type guard helpers

For reusable narrowing logic, create type guard functions:

```typescript
function isHeroBlock(block: Landing['content'][number]): block is HeroBlock {
    return block.__component === 'landing.hero-block'
}

function isTextBlock(block: Landing['content'][number]): block is TextBlock {
    return block.__component === 'landing.text-block'
}

// Usage
const heroes = landing.data?.content?.filter(isHeroBlock) ?? []
// heroes is typed as HeroBlock[]
```

## Rendering Dynamic Zones in React

A common pattern for rendering Dynamic Zones in a frontend framework:

```tsx
import type {
    Landing,
    HeroBlock,
    TextBlock,
    GalleryBlock,
} from '@myapp/strapi-types'

const componentMap: Record<string, React.FC<any>> = {
    'landing.hero-block': HeroSection,
    'landing.text-block': TextSection,
    'landing.gallery-block': GallerySection,
}

function DynamicZone({ blocks }: { blocks: Landing['content'] }) {
    if (!blocks) return null

    return (
        <>
            {blocks.map((block, index) => {
                const Component = componentMap[block.__component]
                if (!Component) return null
                return <Component key={index} {...block} />
            })}
        </>
    )
}
```

## Input Types for Dynamic Zones

When creating or updating entries with Dynamic Zone content, you must include the `__component` field in each block so Strapi knows which component type to use:

```typescript
await strapi.landings.create({
    data: {
        title: 'New Landing Page',
        content: [
            {
                __component: 'landing.hero-block',
                heading: 'Welcome',
                subheading: 'Get started today',
            },
            {
                __component: 'landing.text-block',
                body: 'This is the introduction paragraph.',
                alignment: 'center',
            },
        ],
    },
})
```

::: warning
Omitting the `__component` field when writing Dynamic Zone data will cause Strapi to reject the request. It is required for every block in the array.
:::

When updating, you replace the entire Dynamic Zone array. Strapi does not support partial updates to individual blocks within a Dynamic Zone:

```typescript
await strapi.landings.update(documentId, {
    data: {
        content: [
            {
                __component: 'landing.hero-block',
                heading: 'Updated Heading',
                subheading: null,
            },
            // Only these blocks will exist after the update
        ],
    },
})
```

## Nullable Behavior

- A Dynamic Zone field is `null` when it has no blocks or has not been populated.
- An empty Dynamic Zone (all blocks removed) returns as an empty array `[]`.
- Individual component fields within the zone follow their own nullability rules based on the Strapi schema.
