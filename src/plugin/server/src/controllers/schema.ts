/**
 * Schema controller for Strapi Types Plugin
 * Exposes endpoints for fetching schema and schema hash
 */

export interface StrapiContext {
    state: {
        user?: unknown
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
    log: {
        error: (message: string, error?: unknown) => void
    }
}

export default ({ strapi }: { strapi: StrapiInstance }) => ({
    /**
     * GET /api/strapi-types/schema
     * Returns the full schema with hash
     */
    async getSchema(ctx: StrapiContext) {
        // Check auth based on config
        const requireAuth = strapi.config.get(
            'plugin::strapi-typed-client.requireAuth',
            process.env.NODE_ENV === 'production',
        )

        if (requireAuth && !ctx.state.user) {
            return ctx.unauthorized('Authentication required to access schema')
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
        // Check auth based on config
        const requireAuth = strapi.config.get(
            'plugin::strapi-typed-client.requireAuth',
            process.env.NODE_ENV === 'production',
        )

        if (requireAuth && !ctx.state.user) {
            return ctx.unauthorized(
                'Authentication required to access schema hash',
            )
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
