# Custom Endpoints

`strapi-typed-client` automatically detects and generates typed methods for your custom Strapi controllers and routes — not just the standard CRUD operations. The plugin reads your route files and controller type annotations at schema generation time.

## How It Works

The plugin scans your Strapi project for custom routes and controllers:

1. **Routes** — reads `src/api/*/routes/*.ts` files to discover custom endpoints (method, path, handler).
2. **Controller types** — looks for an `export interface Endpoints` in controller files to extract request/response types.
3. **Extra types** — picks up any standalone `export type` or `export interface` from controllers and includes them in the generated output.

The generated client adds typed methods for each custom endpoint directly on the corresponding collection API or as a standalone API.

## Defining Typed Custom Endpoints

### 1. Create a custom route

```typescript
// src/api/article/routes/custom-routes.ts
export default {
    routes: [
        {
            method: 'POST',
            path: '/articles/:id/publish',
            handler: 'article.publish',
        },
        {
            method: 'GET',
            path: '/articles/trending',
            handler: 'article.trending',
        },
    ],
}
```

Both the short handler format and the full Strapi UID format are supported:

```typescript
// Short format
handler: 'article.publish'

// Full format (api:: prefix)
handler: 'api::article.article.publish'

// Plugin format
handler: 'plugin::my-plugin.controller.action'
```

### 2. Add an `Endpoints` interface to the controller

The plugin looks for an `export interface Endpoints` in the controller file. Each key maps to a handler action, and you can specify `body` (request) and `response` types:

```typescript
// src/api/article/controllers/article.ts
import { factories } from '@strapi/strapi'

export interface Endpoints {
    publish: {
        body: {
            scheduledAt?: string
            notifySubscribers: boolean
        }
        response: {
            data: {
                publishedAt: string
                url: string
            }
        }
    }
    trending: {
        response: {
            data: {
                id: number
                title: string
                views: number
            }[]
        }
    }
}

export default factories.createCoreController(
    'api::article.article',
    ({ strapi }) => ({
        async publish(ctx) {
            const { id } = ctx.params
            const { scheduledAt, notifySubscribers } = ctx.request.body
            // ... business logic
            ctx.body = { data: { publishedAt: '...', url: '...' } }
        },

        async trending(ctx) {
            // ... fetch trending articles
            ctx.body = { data: [{ id: 1, title: '...', views: 1500 }] }
        },
    }),
)
```

### 3. Generated output

After running `strapi-types generate`, the client will include typed methods:

```typescript
// Generated — you get full autocomplete
const result = await strapi.articles.publish('article-id', {
    notifySubscribers: true,
})

result.publishedAt // string
result.url // string

const trending = await strapi.articles.trending()
trending[0].title // string
trending[0].views // number
```

## Endpoints Interface Reference

Each action in the `Endpoints` interface supports these fields:

| Field      | Description                                    |
| ---------- | ---------------------------------------------- |
| `body`     | Request body type (for POST/PUT/PATCH methods) |
| `response` | Response type (wrapped in `{ data: ... }`)     |
| `params`   | Path parameter types                           |
| `query`    | Query string parameter types                   |

::: tip
The `response` field should include the `{ data: ... }` wrapper that your controller returns. The generator automatically unwraps it — the generated method returns the inner type directly.
:::

## Extra Exported Types

Any standalone `export type` or `export interface` in a controller file (other than `Endpoints`) is automatically picked up and included in the generated types under a namespace:

```typescript
// src/api/search/controllers/search.ts

export type SearchResultType = 'article' | 'page' | 'product'

export interface SearchHit {
    id: number
    title: string
    type: SearchResultType
    score: number
}

export interface Endpoints {
    query: {
        body: {
            term: string
            filters?: { type?: SearchResultType }
        }
        response: {
            data: SearchHit[]
        }
    }
}
```

The generated output will include:

```typescript
export namespace SearchAPI {
    export type SearchResultType = 'article' | 'page' | 'product'

    export interface SearchHit {
        id: number
        title: string
        type: SearchResultType
        score: number
    }

    export type QueryRequest = {
        term: string
        filters?: { type?: SearchResultType }
    }

    export type QueryResponse = SearchHit[]
}
```

## Standalone APIs (No Content Type)

Custom APIs that don't correspond to a Strapi content type are generated as standalone API classes on the client:

```typescript
// src/api/contact/routes/custom-routes.ts
export default {
    routes: [
        {
            method: 'POST',
            path: '/contact/submit',
            handler: 'contact.submit',
        },
    ],
}
```

```typescript
// Generated client usage
await strapi.contact.submit({
    name: 'Jane',
    email: 'jane@example.com',
    message: 'Hi',
})
```

## FormData Support

Custom methods support both JSON and `FormData` as input. This is useful for file upload endpoints:

```typescript
// JSON body
await strapi.articles.publish('article-id', {
    notifySubscribers: true,
})

// FormData body (e.g., for a custom file import endpoint)
const formData = new FormData()
formData.append('file', csvFile)
await strapi.imports.upload(formData)
```

## Without Type Annotations

If a custom route exists but the controller has no `Endpoints` interface, the generated method still appears but with `any` types for input and output:

```typescript
// No Endpoints interface in controller — types default to any
await strapi.articles.publish('id', data) // data: any, returns any
```

You can add the `Endpoints` interface later to get full type safety without changing anything else.

## Path Parameters

Path parameters (`:id`, `:slug`, etc.) are automatically extracted and become method arguments:

```typescript
// Route: { path: '/articles/:id/publish', handler: 'article.publish' }
// Generated method:
await strapi.articles.publish('article-id-here', { notifySubscribers: true })

// Route: { path: '/categories/:slug/featured', handler: 'category.featured' }
// Generated method:
await strapi.categories.featured('technology')
```
