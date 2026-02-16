/**
 * Routes for Strapi Types Plugin
 * Defines content-api routes for schema access
 */

export default [
    {
        method: 'GET',
        path: '/schema',
        handler: 'schema.getSchema',
        config: {
            auth: false,
        },
    },
    {
        method: 'GET',
        path: '/schema-hash',
        handler: 'schema.getSchemaHash',
        config: {
            auth: false,
        },
    },
    {
        method: 'GET',
        path: '/schema-watch',
        handler: 'schema.schemaWatch',
        config: {
            auth: false,
        },
    },
]
