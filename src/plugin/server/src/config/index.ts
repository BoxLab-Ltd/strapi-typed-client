/**
 * Configuration for Strapi Types Plugin
 */

export default {
    default: {
        /**
         * Whether authentication is required to access schema endpoints
         * By default: false in development, true in production
         *
         * Can be overridden in config/plugins.ts:
         * @example
         * ```typescript
         * export default {
         *   'strapi-types': {
         *     enabled: true,
         *     config: {
         *       requireAuth: false, // Allow unauthenticated access
         *     },
         *   },
         * }
         * ```
         */
        requireAuth: process.env.NODE_ENV === 'production',
    },

    /**
     * Validator for plugin configuration
     */
    validator(config: Record<string, unknown>) {
        if (
            typeof config.requireAuth !== 'undefined' &&
            typeof config.requireAuth !== 'boolean'
        ) {
            throw new Error(
                'strapi-types: config.requireAuth must be a boolean',
            )
        }
    },
}
