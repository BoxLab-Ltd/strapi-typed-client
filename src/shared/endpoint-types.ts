/**
 * Shared endpoint types used by both the Strapi plugin (server) and CLI
 * @module shared/endpoint-types
 */

/**
 * Type information for a custom endpoint (body, response, params, query)
 */
export interface EndpointType {
    body?: string
    response?: string
    params?: string
    query?: string
}

/**
 * A parsed endpoint from Strapi custom routes
 */
export interface ParsedEndpoint {
    method: string
    path: string
    handler: string
    controller: string
    action: string
    types?: EndpointType
}

/**
 * Extra exported type from a controller file (not part of Endpoints interface)
 * e.g., `export type SSEEvent = { type: 'connected' } | { type: 'progress', ... }`
 */
export interface ExtraControllerType {
    controller: string
    typeName: string
    typeDefinition: string
}

/**
 * Response from the endpoints service
 */
export interface EndpointsResponse {
    endpoints: ParsedEndpoint[]
    extraTypes: ExtraControllerType[]
    count: number
}
