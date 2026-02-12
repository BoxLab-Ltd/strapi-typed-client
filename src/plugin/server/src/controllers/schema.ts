/**
 * Schema controller for Strapi Types Plugin
 * Exposes endpoints for fetching schema and schema hash
 */

export interface StrapiContext {
    state: {
        user?: unknown
    }
    request: {
        header: Record<string, string | undefined>
    }
    unauthorized: (message: string) => void
    body: unknown
}

export interface StrapiInstance {
    config: {
        get: (key: string, defaultValue?: unknown) => unknown
    }
    plugin: (name: string) => {
        service: (name: string) => {
            getSchema: () => unknown
            getSchemaHash: () => unknown
        }
    }
    service: (uid: string) => any
    log: {
        error: (message: string, error?: unknown) => void
    }
}

/**
 * Manually validate an API token since routes use auth: false
 * (Strapi skips its auth middleware when auth: false is set)
 */
async function validateApiToken(
    strapi: StrapiInstance,
    ctx: StrapiContext,
): Promise<boolean> {
    // Already authenticated via other means
    if (ctx.state.user) return true

    const authorization = ctx.request.header.authorization
    if (!authorization) return false

    const [scheme, token] = authorization.split(' ')
    if (scheme !== 'Bearer' || !token) return false

    try {
        const apiTokenService = strapi.service('admin::api-token')
        const accessKey = await apiTokenService.hash(token)
        const storedToken = await apiTokenService.getBy({ accessKey })
        return !!storedToken
    } catch {
        return false
    }
}

export default ({ strapi }: { strapi: StrapiInstance }) => ({
    /**
     * GET /api/strapi-types/schema
     * Returns the full schema with hash
     */
    async getSchema(ctx: StrapiContext) {
        const requireAuth = strapi.config.get(
            'plugin::strapi-typed-client.requireAuth',
            process.env.NODE_ENV === 'production',
        )

        if (requireAuth) {
            const isAuthenticated = await validateApiToken(strapi, ctx)
            if (!isAuthenticated) {
                return ctx.unauthorized(
                    'Authentication required to access schema',
                )
            }
        }

        try {
            const schemaService = strapi
                .plugin('strapi-typed-client')
                .service('schema')
            const result = schemaService.getSchema()

            ctx.body = result
        } catch (error) {
            strapi.log.error('Error extracting schema:', error)
            throw error
        }
    },

    /**
     * GET /api/strapi-types/schema-hash
     * Returns only the schema hash (lightweight)
     */
    async getSchemaHash(ctx: StrapiContext) {
        const requireAuth = strapi.config.get(
            'plugin::strapi-typed-client.requireAuth',
            process.env.NODE_ENV === 'production',
        )

        if (requireAuth) {
            const isAuthenticated = await validateApiToken(strapi, ctx)
            if (!isAuthenticated) {
                return ctx.unauthorized(
                    'Authentication required to access schema hash',
                )
            }
        }

        try {
            const schemaService = strapi
                .plugin('strapi-typed-client')
                .service('schema')
            const result = schemaService.getSchemaHash()

            ctx.body = result
        } catch (error) {
            strapi.log.error('Error computing schema hash:', error)
            throw error
        }
    },
})
