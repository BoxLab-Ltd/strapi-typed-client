# Plugin Configuration

The `strapi-typed-client` package includes a Strapi plugin that exposes your content type schema via HTTP endpoints. The CLI generator uses these endpoints to fetch the schema and generate TypeScript types. This page covers the full plugin setup and configuration options.

## Installation

The plugin is included in the `strapi-typed-client` package. No separate installation is needed — just add `strapi-typed-client` to your Strapi project's dependencies.

## Registering the Plugin

Strapi auto-discovers the plugin thanks to the `strapi` field in `package.json`. You only need to enable it in `config/plugins.ts`:

```typescript
// config/plugins.ts
export default {
    'strapi-typed-client': {
        enabled: true,
    },
}
```

With configuration options:

```typescript
// config/plugins.ts
export default {
    'strapi-typed-client': {
        enabled: true,
        config: {
            requireAuth: true,
        },
    },
}
```

::: info
No `import` or `resolve` is needed. Strapi detects the plugin automatically when the package is installed and the `strapi.kind === 'plugin'` field is present in its `package.json`.
:::

## Configuration Options

### `requireAuth`

- **Type:** `boolean`
- **Default:** `false` in development, `true` in production (`NODE_ENV === 'production'`)

Controls whether the schema endpoints require a valid Bearer token in the `Authorization` header.

```typescript
// Explicit public access
'strapi-typed-client': {
  enabled: true,
  config: {
    requireAuth: false,
  },
}

// Explicit protected access
'strapi-typed-client': {
  enabled: true,
  config: {
    requireAuth: true,
  },
}
```

When `requireAuth` is `true`:

- All schema endpoint requests must include a valid `Authorization: Bearer <token>` header.
- Unauthenticated requests receive a `401 Unauthorized` response.
- The CLI must be invoked with the `--token` flag or have the `STRAPI_TOKEN` environment variable set.

::: warning
If you do not set `requireAuth` explicitly, it defaults based on `NODE_ENV`. In production your schema endpoint is protected automatically. Set `requireAuth: false` explicitly if you want to keep it public in production (not recommended).
:::

## Plugin Endpoints

The plugin registers two endpoints under the `/api/strapi-typed-client` namespace.

### `GET /api/strapi-typed-client/schema`

Returns the complete content type schema as JSON, along with a hash of the schema.

**Response format:**

```json
{
    "hash": "a1b2c3d4e5f6...",
    "schema": {
        "contentTypes": {
            "api::post.post": {
                "kind": "collectionType",
                "singularName": "post",
                "pluralName": "posts",
                "attributes": {
                    "title": {
                        "type": "string",
                        "required": true
                    },
                    "content": {
                        "type": "richtext"
                    },
                    "author": {
                        "type": "relation",
                        "relation": "manyToOne",
                        "target": "plugin::users-permissions.user"
                    }
                }
            }
        },
        "components": {
            "landing.hero-block": {
                "attributes": {
                    "heading": {
                        "type": "string"
                    },
                    "backgroundImage": {
                        "type": "media"
                    }
                }
            }
        }
    }
}
```

**Example request:**

```bash
# Without auth
curl http://localhost:1337/api/strapi-typed-client/schema

# With auth
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:1337/api/strapi-typed-client/schema
```

### `GET /api/strapi-typed-client/schema-hash`

Returns only the schema hash. This is a lightweight endpoint designed for polling in watch mode, avoiding the overhead of transmitting the full schema on every check.

**Response format:**

```json
{
    "hash": "a1b2c3d4e5f6..."
}
```

**Example request:**

```bash
curl http://localhost:1337/api/strapi-typed-client/schema-hash
```

## Creating an API Token

When `requireAuth` is enabled, the CLI and any direct endpoint calls need a Bearer token. Here's how to create one:

1. Open the **Strapi admin panel** (usually `http://localhost:1337/admin`).
2. Go to **Settings** in the left sidebar.
3. Under **Global Settings**, click **API Tokens**.
4. Click **Create new API Token**.
5. Fill in the details:
    - **Name** — descriptive name (e.g., "Types Generator", "CI/CD Schema")
    - **Token type** — `Read-only` is sufficient for schema fetching
    - **Token duration** — choose `Unlimited` for development, set an expiration for production
6. Click **Save**.
7. **Copy the token immediately** — it is only shown once.

::: warning
Store the token securely. If you lose it, you will need to regenerate a new one. Never commit tokens to version control — use environment variables or a secrets manager.
:::

### Token Types

| Type        | Permissions                               | Best For                               |
| ----------- | ----------------------------------------- | -------------------------------------- |
| Read-only   | `find` and `findOne` on all content types | Schema fetching (CLI), public frontend |
| Full access | All CRUD operations on all content types  | Admin dashboards, server-side apps     |
| Custom      | Fine-grained per-content-type             | Specific use cases                     |

For the CLI type generation, **Read-only** is sufficient since it only reads the schema.

## Schema Hashing

The plugin computes a deterministic hash of the entire schema (content types + components). This hash is used by the CLI to avoid unnecessary regeneration.

### How It Works

1. The plugin serializes the full schema (content types and components) into a stable JSON string.
2. It computes a hash (SHA-256) of that string.
3. The hash is included in both the `/schema` and `/schema-hash` responses.

### CLI Usage

The CLI stores the hash of the last generated schema. On subsequent runs, it first calls `/schema-hash` to check if the schema has changed:

```
CLI                              Strapi Plugin
 │                                     │
 │  GET /schema-hash                   │
 │────────────────────────────────────►│
 │                                     │
 │  { "hash": "abc123" }              │
 │◄────────────────────────────────────│
 │                                     │
 │  Compare with stored hash           │
 │                                     │
 │  [If different]                     │
 │  GET /schema                        │
 │────────────────────────────────────►│
 │                                     │
 │  { "hash": "abc123", "schema": {…}} │
 │◄────────────────────────────────────│
 │                                     │
 │  Generate types                     │
 │  Store new hash                     │
```

This means:

- If the schema has not changed, the CLI skips regeneration entirely.
- Only a tiny JSON payload is transferred on each check.
- In watch mode, the CLI periodically polls `/schema-hash` and only fetches the full schema when the hash changes.

::: tip
The hash-based approach makes watch mode efficient even for large schemas. The `/schema-hash` endpoint is fast and returns minimal data, so frequent polling has negligible impact on server performance.
:::

## Security Considerations

The schema endpoint exposes the complete structure of your Strapi content model, including:

- All content type names and their fields
- Field types and validation rules
- Relation targets and cardinality
- Component structures
- Enumeration values

### When to Enable `requireAuth`

| Environment       | Recommendation       | Reason                                       |
| ----------------- | -------------------- | -------------------------------------------- |
| Local development | `requireAuth: false` | Convenience; no tokens to manage             |
| Staging           | `requireAuth: true`  | Prevent leaking schema to unauthorized users |
| Production        | `true` (default)     | Schema structure should not be public        |
| CI/CD             | `requireAuth: true`  | Use secrets for token management             |

::: warning
With `requireAuth: false`, anyone with network access to your Strapi instance can view the full schema. In any environment accessible beyond your local machine, keep `requireAuth` enabled (the production default).
:::

### Network-Level Protection

In addition to `requireAuth`, consider network-level protections:

- Run Strapi behind a reverse proxy and restrict `/api/strapi-typed-client/*` routes to trusted IPs.
- In CI/CD, use internal network addresses or VPN to access the Strapi instance.
- Use short-lived API tokens where possible.

## Full Configuration Example

A complete `config/plugins.ts` showing the plugin alongside other common Strapi plugins:

```typescript
export default ({ env }) => ({
    // strapi-typed-client plugin — auto-discovered, just enable + configure
    'strapi-typed-client': {
        enabled: true,
        config: {
            requireAuth: env('NODE_ENV') === 'production',
        },
    },

    // Other plugins
    upload: {
        config: {
            provider: 'aws-s3',
        },
    },
    email: {
        config: {
            provider: 'sendgrid',
        },
    },
})
```

::: tip
Using `env('NODE_ENV') === 'production'` makes the behavior explicit in your config, matching the default behavior. This way it's clear to anyone reading the config what happens in each environment.
:::

## Troubleshooting

### 401 Unauthorized when generating types

The plugin has `requireAuth: true` (or you're in production where it defaults to `true`) and you are not providing a token. Pass the token to the CLI:

```bash
npx strapi-types generate --url http://localhost:1337 --token YOUR_TOKEN
```

### 404 Not Found on schema endpoint

The plugin is not registered or not enabled. Verify that:

1. `strapi-typed-client` is in your Strapi project's `dependencies` (not just `devDependencies`).
2. `config/plugins.ts` has `'strapi-typed-client': { enabled: true }`.
3. You have restarted Strapi after changing the config.

### Schema hash does not change after modifying a content type

Restart your Strapi development server. The plugin reads the schema from Strapi's runtime registry, which updates on server start.
