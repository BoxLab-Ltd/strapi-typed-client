/**
 * Core utilities for Strapi Types Generator
 * @module core
 */

// Schema transformation
export {
    transformSchema,
    type ExtractedSchema,
    type StrapiAttribute,
    type StrapiContentType,
    type StrapiComponent,
} from './schema-transformer.js'

// Endpoint conversion (remote endpoints → generator formats)
export {
    convertEndpointsToRoutes,
    convertEndpointsToCustomTypes,
} from './endpoint-converter.js'

// Filters generation
export {
    generateFilterUtilityTypes,
    generateEntityFilters,
    generateTypedQueryParams,
} from './generator/filters-generator.js'
