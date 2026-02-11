# Custom Endpoints

The `strapi-typed-client` generator covers all standard Strapi REST API endpoints for your content types. However, you may have custom controllers and routes in your Strapi backend that fall outside the standard CRUD operations. This page explains how to work with custom endpoints alongside the typed client.

## What Gets Generated

The generated client provides typed methods for Strapi's standard REST API:

- `find()` — `GET /api/{pluralName}`
- `findOne(documentId)` — `GET /api/{pluralName}/{documentId}`
- `create(data)` — `POST /api/{pluralName}`
- `update(documentId, data)` — `PUT /api/{pluralName}/{documentId}`
- `delete(documentId)` — `DELETE /api/{pluralName}/{documentId}`

Custom endpoints (e.g., `POST /api/orders/checkout`, `GET /api/search`) are **not** automatically generated because they have custom request/response shapes that cannot be inferred from the Strapi schema.

## Using the Base Fetch Approach

The simplest way to call custom endpoints is to create a helper function that shares the same base URL and authentication configuration as your typed client:

```typescript
import { StrapiClient } from '@myapp/strapi-types'

const strapi = new StrapiClient({
    baseURL: 'http://localhost:1337',
    token: process.env.STRAPI_TOKEN,
})

// Helper for custom endpoints
async function customFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${strapi.baseURL}${path}`
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(strapi.token && { Authorization: `Bearer ${strapi.token}` }),
            ...options?.headers,
        },
    })

    if (!response.ok) {
        throw new Error(
            `Request failed: ${response.status} ${response.statusText}`,
        )
    }

    return response.json()
}

// Use the typed client for standard CRUD
const posts = await strapi.posts.find()

// Use the helper for custom endpoints
const searchResults = await customFetch<SearchResponse>('/api/search?q=hello')

const checkoutResult = await customFetch<CheckoutResponse>(
    '/api/orders/checkout',
    {
        method: 'POST',
        body: JSON.stringify({ cartId: '123', paymentMethod: 'card' }),
    },
)
```

## Extending the Client

For a more structured approach, you can extend the `StrapiClient` class to add custom methods:

```typescript
import { StrapiClient } from '@myapp/strapi-types'

// Define your custom response types
interface SearchResult {
    id: number
    documentId: string
    title: string
    contentType: string
    score: number
}

interface SearchResponse {
    data: SearchResult[]
    meta: { total: number }
}

interface CheckoutPayload {
    cartId: string
    paymentMethod: 'card' | 'paypal'
    shippingAddress: string
}

interface OrderConfirmation {
    orderId: string
    status: string
    total: number
}

// Extend the generated client
class AppClient extends StrapiClient {
    async search(query: string): Promise<SearchResponse> {
        const url = `${this.baseURL}/api/search?q=${encodeURIComponent(query)}`
        const response = await this.fetchFn(url, {
            headers: this.getHeaders(),
        })

        if (!response.ok) {
            throw new Error(`Search failed: ${response.statusText}`)
        }

        return response.json()
    }

    async checkout(payload: CheckoutPayload): Promise<OrderConfirmation> {
        const url = `${this.baseURL}/api/orders/checkout`
        const response = await this.fetchFn(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ data: payload }),
        })

        if (!response.ok) {
            throw new Error(`Checkout failed: ${response.statusText}`)
        }

        return response.json()
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        }
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`
        }
        return headers
    }
}

// Usage
const client = new AppClient({
    baseURL: 'http://localhost:1337',
    token: process.env.STRAPI_TOKEN,
})

// Standard typed methods
const posts = await client.posts.find()

// Custom methods
const results = await client.search('typescript')
const order = await client.checkout({
    cartId: '456',
    paymentMethod: 'card',
    shippingAddress: '123 Main St',
})
```

## Wrapper Module Pattern

Another approach is to create a dedicated API module that combines the typed client with custom endpoint functions:

```typescript
// lib/api.ts
import { StrapiClient } from '@myapp/strapi-types'

export const strapi = new StrapiClient({
    baseURL: process.env.NEXT_PUBLIC_STRAPI_URL!,
    token: process.env.STRAPI_TOKEN,
})

// Custom endpoint functions
export async function globalSearch(query: string) {
    const res = await fetch(
        `${process.env.NEXT_PUBLIC_STRAPI_URL}/api/search`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.STRAPI_TOKEN}`,
            },
            body: JSON.stringify({ query }),
        },
    )

    if (!res.ok) throw new Error('Search failed')
    return res.json() as Promise<{ data: SearchResult[] }>
}

export async function submitContactForm(data: ContactFormData) {
    const res = await fetch(
        `${process.env.NEXT_PUBLIC_STRAPI_URL}/api/contact/submit`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ data }),
        },
    )

    if (!res.ok) throw new Error('Submission failed')
    return res.json()
}
```

Then import from a single location:

```typescript
import { strapi, globalSearch, submitContactForm } from '@/lib/api'

// Typed Strapi queries
const posts = await strapi.posts.find({ sort: 'createdAt:desc' })

// Custom endpoints
const results = await globalSearch('strapi')
await submitContactForm({
    name: 'Jane',
    email: 'jane@example.com',
    message: 'Hello',
})
```

## Next.js Compatibility

Custom endpoint calls can also use Next.js fetch options for caching and revalidation:

```typescript
async function getPopularPosts() {
    const res = await fetch(
        `${process.env.NEXT_PUBLIC_STRAPI_URL}/api/posts/popular`,
        {
            headers: {
                Authorization: `Bearer ${process.env.STRAPI_TOKEN}`,
            },
            next: {
                revalidate: 600, // Revalidate every 10 minutes
                tags: ['popular-posts'],
            },
        },
    )

    if (!res.ok) throw new Error('Failed to fetch popular posts')
    return res.json()
}
```

::: tip
Since Next.js patches the global `fetch`, you get automatic caching and revalidation support even for custom endpoint calls, as long as you use the standard `fetch` API.
:::

## Limitations

- Custom endpoints do not get automatic TypeScript type generation. You need to define request and response types manually.
- The generator only introspects Strapi's content type schema. Custom controller logic is invisible to the code generator.
- If your custom endpoint returns standard Strapi content types, consider using the typed client's `find()` or `findOne()` methods with appropriate filters instead.

::: info
If you find yourself creating many custom endpoints that return standard content types with custom filtering, check whether Strapi's built-in filtering, sorting, and population features can achieve the same result. The typed client's `filters` parameter supports complex queries including `$and`, `$or`, `$contains`, and nested relation filters.
:::
