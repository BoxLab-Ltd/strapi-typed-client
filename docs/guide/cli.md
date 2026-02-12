# CLI Reference

The `strapi-types` CLI fetches your Strapi schema and generates TypeScript types and a typed client.

## Commands

### `generate`

Connects to your Strapi instance, fetches the schema, and generates TypeScript output files.

```bash
npx strapi-types generate --url http://localhost:1337
```

**Options:**

| Option     | Description                               | Default                                 |
| ---------- | ----------------------------------------- | --------------------------------------- |
| `--url`    | Strapi server URL                         | `STRAPI_URL` env var                    |
| `--token`  | API token for authenticated access        | `STRAPI_TOKEN` env var                  |
| `--output` | Output directory for generated files      | `node_modules/strapi-typed-client/dist` |
| `--silent` | Suppress all console output               | `false`                                 |
| `--force`  | Regenerate even if schema has not changed | `false`                                 |

**Examples:**

```bash
# Basic generation
npx strapi-types generate --url http://localhost:1337

# With authentication
npx strapi-types generate --url http://localhost:1337 --token abc123

# Custom output directory, silent mode
npx strapi-types generate --url http://localhost:1337 --output ./src/api --silent

# Force regeneration (ignore schema hash)
npx strapi-types generate --url http://localhost:1337 --force
```

### `check`

Verifies that the CLI can connect to your Strapi instance and that the plugin is properly registered.

```bash
npx strapi-types check --url http://localhost:1337
```

This is useful for CI pipelines or debugging connection issues. It will:

1. Attempt to reach the schema endpoint
2. Report whether the plugin is accessible
3. Exit with code 0 on success, 1 on failure

**Example:**

```bash
npx strapi-types check --url http://localhost:1337 --token abc123
```

### `watch`

Polls the Strapi schema endpoint at regular intervals and automatically regenerates types when the schema changes.

```bash
npx strapi-types watch --url http://localhost:1337
```

This is useful during development. The command runs continuously and:

1. Fetches the schema hash from `/api/strapi-typed-client/schema-hash`
2. Compares it to the last known hash
3. Regenerates types only when the hash changes

::: tip
For Next.js projects, consider using the `withStrapiTypes` wrapper instead of running `watch` manually. See the [Next.js guide](/guide/nextjs).
:::

## Environment Variables

Instead of passing flags on every invocation, you can set environment variables:

| Variable       | Equivalent Flag |
| -------------- | --------------- |
| `STRAPI_URL`   | `--url`         |
| `STRAPI_TOKEN` | `--token`       |

**Example with a `.env` file:**

```bash
# .env
STRAPI_URL=http://localhost:1337
STRAPI_TOKEN=your-api-token-here
```

```bash
# Now you can run without flags
npx strapi-types generate
```

::: warning
CLI flags take precedence over environment variables. If both are provided, the flag value is used.
:::

## Schema Hashing

The CLI uses schema hashing to avoid unnecessary regeneration. When you run `generate`:

1. The CLI fetches the schema hash from `/api/strapi-typed-client/schema-hash`
2. It compares the hash against the previously stored hash
3. If the hashes match, generation is skipped (unless `--force` is used)
4. If the hashes differ, types are regenerated and the new hash is stored

This makes it safe to run `generate` in CI or on every build without wasting time on unchanged schemas.

```bash
# First run — generates types
npx strapi-types generate --url http://localhost:1337

# Second run — skipped, schema unchanged
npx strapi-types generate --url http://localhost:1337

# Force regeneration regardless of hash
npx strapi-types generate --url http://localhost:1337 --force
```

## Usage in package.json Scripts

A typical setup in your frontend project:

```json
{
    "scripts": {
        "generate-types": "strapi-types generate",
        "check-strapi": "strapi-types check",
        "dev": "strapi-types watch & next dev",
        "build": "strapi-types generate --force && next build"
    }
}
```
