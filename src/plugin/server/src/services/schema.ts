/**
 * Schema service for Strapi Types Plugin
 * Extracts schema information from Strapi and computes hashes for change detection
 */

import { computeSchemaHash } from '../../../../shared/schema-hash.js'
import { SYSTEM_FIELDS, PRIVATE_FIELDS } from '../../../../shared/constants.js'
import type {
    ParsedEndpoint,
    ExtraControllerType,
} from '../../../../shared/endpoint-types.js'
import type {
    StrapiAttribute,
    StrapiContentType,
    StrapiComponent,
    ExtractedSchema,
    SchemaResponse,
    HashResponse,
} from '../../../../shared/strapi-schema-types.js'

export type {
    StrapiAttribute,
    StrapiContentType,
    StrapiComponent,
    ExtractedSchema,
    SchemaResponse,
    HashResponse,
    ParsedEndpoint,
    ExtraControllerType,
}

/**
 * Filter out system attributes that shouldn't be exposed
 */
function filterAttributes(
    attributes: Record<string, StrapiAttribute>,
): Record<string, StrapiAttribute> {
    // Combine system fields (createdAt, updatedAt — added by generator as base fields)
    // and private fields (createdBy, updatedBy, publishedAt, locale, localizations)
    const systemFields: string[] = [
        ...SYSTEM_FIELDS.filter(f => f !== 'id' && f !== 'documentId'),
        ...PRIVATE_FIELDS,
    ]

    const filtered: Record<string, StrapiAttribute> = {}

    for (const [name, attr] of Object.entries(attributes)) {
        // Skip system fields
        if (systemFields.includes(name)) {
            continue
        }

        // Skip private attributes
        if (attr.private) {
            continue
        }

        // Skip admin relations
        if (attr.type === 'relation') {
            const target = attr.target as string
            if (target?.startsWith('admin::')) {
                continue
            }
            // Allow users-permissions relations
            if (
                target?.startsWith('plugin::') &&
                !target.includes('users-permissions')
            ) {
                continue
            }
        }

        filtered[name] = attr
    }

    return filtered
}

/**
 * Extract clean content type schema
 */
function extractContentType(ct: any): StrapiContentType | null {
    const uid = ct.uid as string

    // Only include API content types and users-permissions
    if (!uid.startsWith('api::') && !uid.includes('users-permissions')) {
        return null
    }

    return {
        uid,
        kind: ct.kind || 'collectionType',
        collectionName: ct.collectionName,
        info: {
            singularName: ct.info?.singularName || '',
            pluralName: ct.info?.pluralName || '',
            displayName: ct.info?.displayName || '',
            description: ct.info?.description,
        },
        attributes: filterAttributes(ct.attributes || {}),
    }
}

/**
 * Extract clean component schema
 */
function extractComponent(component: any): StrapiComponent | null {
    const uid = component.uid as string

    return {
        uid,
        category: component.category || uid.split('.')[0],
        info: {
            displayName: component.info?.displayName || '',
            description: component.info?.description,
        },
        attributes: filterAttributes(component.attributes || {}),
    }
}

export default ({ strapi }: { strapi: any }) => ({
    /**
     * Extract the complete schema from Strapi
     */
    extractSchema(): ExtractedSchema {
        const contentTypes: Record<string, StrapiContentType> = {}
        const components: Record<string, StrapiComponent> = {}

        // Extract content types
        for (const [uid, ct] of Object.entries(strapi.contentTypes)) {
            const extracted = extractContentType(ct)
            if (extracted) {
                contentTypes[uid] = extracted
            }
        }

        // Extract components
        for (const [uid, component] of Object.entries(strapi.components)) {
            const extracted = extractComponent(component)
            if (extracted) {
                components[uid] = extracted
            }
        }

        return { contentTypes, components }
    },

    /**
     * Get the full schema with hash and endpoints
     */
    getSchema(): SchemaResponse {
        const schema = this.extractSchema()

        // Get endpoints from endpoints service
        let endpoints: ParsedEndpoint[] = []
        let extraTypes: ExtraControllerType[] = []
        try {
            const endpointsService = strapi
                .plugin('strapi-typed-client')
                .service('endpoints')
            if (endpointsService) {
                const endpointsResult = endpointsService.extractEndpoints()
                endpoints = endpointsResult.endpoints
                extraTypes = endpointsResult.extraTypes || []
            }
        } catch {
            // Endpoints service might not be available, continue without endpoints
        }

        // Include endpoints and extraTypes in hash computation for complete change detection
        const hashData = { schema, endpoints, extraTypes }
        const hash = computeSchemaHash(hashData)

        return {
            schema,
            endpoints,
            extraTypes,
            hash,
            generatedAt: new Date().toISOString(),
        }
    },

    /**
     * Get only the schema hash (lightweight operation)
     */
    getSchemaHash(): HashResponse {
        const schema = this.extractSchema()

        // Include endpoints and extraTypes in hash computation for consistency with getSchema()
        let endpoints: ParsedEndpoint[] = []
        let extraTypes: ExtraControllerType[] = []
        try {
            const endpointsService = strapi
                .plugin('strapi-typed-client')
                .service('endpoints')
            if (endpointsService) {
                const endpointsResult = endpointsService.extractEndpoints()
                endpoints = endpointsResult.endpoints
                extraTypes = endpointsResult.extraTypes || []
            }
        } catch {
            // Endpoints service might not be available
        }

        const hashData = { schema, endpoints, extraTypes }
        const hash = computeSchemaHash(hashData)

        return {
            hash,
            generatedAt: new Date().toISOString(),
        }
    },
})
