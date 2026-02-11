/**
 * Endpoint Converter
 *
 * Converts ParsedEndpoint[] (from Strapi plugin) to the formats
 * used by the existing generators: ParsedRoutes + ParsedCustomTypes.
 *
 * This bridges the remote schema approach (server plugin) with the
 * existing local file-based generators.
 *
 * @module core/endpoint-converter
 */

import type {
    ParsedEndpoint,
    ExtraControllerType,
} from '../shared/endpoint-types.js'
import type { ParsedRoute, ParsedRoutes } from '../parser/routes-parser.js'
import type {
    ParsedCustomTypes,
    CustomEndpointType,
} from '../parser/custom-types-parser.js'
import {
    extractPathParams,
    toPascalCasePreserve,
} from '../shared/string-utils.js'

/**
 * Convert ParsedEndpoint[] to ParsedRoutes format
 */
export function convertEndpointsToRoutes(
    endpoints: ParsedEndpoint[],
): ParsedRoutes {
    const byController = new Map<string, ParsedRoute[]>()
    const all: ParsedRoute[] = []

    for (const endpoint of endpoints) {
        const route: ParsedRoute = {
            method: endpoint.method as ParsedRoute['method'],
            path: endpoint.path,
            handler: endpoint.handler,
            controller: endpoint.controller,
            action: endpoint.action,
            params: extractPathParams(endpoint.path),
        }

        all.push(route)

        if (!byController.has(route.controller)) {
            byController.set(route.controller, [])
        }
        byController.get(route.controller)!.push(route)
    }

    return { byController, all }
}

/**
 * Convert ParsedEndpoint[] to ParsedCustomTypes format
 *
 * Extracts inline type definitions from endpoint types (body/response)
 * and creates handler-to-type mappings.
 */
export function convertEndpointsToCustomTypes(
    endpoints: ParsedEndpoint[],
    extraTypes?: ExtraControllerType[],
): ParsedCustomTypes {
    const types = new Map<string, CustomEndpointType>()
    const typeDefinitions: string[] = []
    const namespaceImports: string[] = []

    // Collect all endpoints that have type information
    const endpointsWithTypes = endpoints.filter(e => e.types)

    // Group by controller to create namespace-like structures
    const byController = new Map<string, ParsedEndpoint[]>()
    for (const endpoint of endpointsWithTypes) {
        if (!byController.has(endpoint.controller)) {
            byController.set(endpoint.controller, [])
        }
        byController.get(endpoint.controller)!.push(endpoint)
    }

    // Group extra types by controller
    const extraByController = new Map<string, ExtraControllerType[]>()
    if (extraTypes) {
        for (const extra of extraTypes) {
            if (!extraByController.has(extra.controller)) {
                extraByController.set(extra.controller, [])
            }
            extraByController.get(extra.controller)!.push(extra)
        }
    }

    // Collect all controller names that need namespaces (from endpoints or extra types)
    const allControllers = new Set<string>([
        ...byController.keys(),
        ...extraByController.keys(),
    ])

    if (allControllers.size === 0) {
        return { types, typeDefinitions, namespaceImports }
    }

    // Generate type definitions for each controller
    for (const controller of allControllers) {
        const namespaceName = toPascalCasePreserve(controller) + 'API'
        const namespaceLines: string[] = []
        namespaceLines.push(`export namespace ${namespaceName} {`)

        // Add extra (standalone) types first
        const controllerExtraTypes = extraByController.get(controller)
        if (controllerExtraTypes) {
            for (const extra of controllerExtraTypes) {
                namespaceLines.push(
                    `  export type ${extra.typeName} = ${extra.typeDefinition}`,
                )
            }
        }

        // Add endpoint-derived types
        const controllerEndpoints = byController.get(controller)
        if (controllerEndpoints) {
            for (const endpoint of controllerEndpoints) {
                if (!endpoint.types) continue
                const actionPascal = toPascalCasePreserve(endpoint.action)

                // Generate Request type from body
                if (endpoint.types.body) {
                    const typeName = `${actionPascal}Request`
                    namespaceLines.push(
                        `  export type ${typeName} = ${endpoint.types.body}`,
                    )

                    // Map handler to input type
                    const existing = types.get(endpoint.handler) || {
                        handler: endpoint.handler,
                    }
                    existing.inputType = `${namespaceName}.${typeName}`
                    types.set(endpoint.handler, existing)
                }

                // Generate Response type from response
                if (endpoint.types.response) {
                    const typeName = `${actionPascal}Response`
                    // Unwrap { data: ... } wrapper — StrapiClient already does response.data
                    const unwrappedResponse = unwrapDataWrapper(
                        endpoint.types.response,
                    )
                    namespaceLines.push(
                        `  export type ${typeName} = ${unwrappedResponse}`,
                    )

                    // Map handler to output type
                    const existing = types.get(endpoint.handler) || {
                        handler: endpoint.handler,
                    }
                    existing.outputType = `${namespaceName}.${typeName}`
                    types.set(endpoint.handler, existing)
                }
            }
        }

        namespaceLines.push('}')

        // Only add namespace if it has content
        if (namespaceLines.length > 2) {
            typeDefinitions.push(namespaceLines.join('\n'))
            namespaceImports.push(namespaceName)
        }
    }

    return { types, typeDefinitions, namespaceImports }
}

/**
 * Unwrap { data: ... } wrapper from response types.
 *
 * Controllers return { data: { ... } } but StrapiClient already
 * does `response.data`, so the type should be the inner content.
 *
 * Examples:
 *   '{ data: { url: string } }' → '{ url: string }'
 *   '{ data: { members: Array<...>, maxSeats: number } }' → '{ members: Array<...>, maxSeats: number }'
 *   'void' → 'void'
 *   '{ status: string }' → '{ status: string }' (no data wrapper)
 */
function unwrapDataWrapper(responseType: string): string {
    const trimmed = responseType.trim()

    // Match pattern: { data: <content> } where content is the rest
    // Use balanced braces to find the outer object
    if (!trimmed.startsWith('{')) return trimmed

    // Check if this is a simple { data: ... } wrapper
    const dataMatch = trimmed.match(/^\{\s*data\s*:\s*/)
    if (!dataMatch) return trimmed

    // Extract content after "{ data: "
    const afterData = trimmed.slice(dataMatch[0].length)

    // Find the matching closing brace for the outer object
    // We need to remove the last } which closes the outer wrapper
    if (afterData.endsWith('}')) {
        const innerContent = afterData.slice(0, -1).trim()

        // Remove trailing semicolons if present
        return innerContent.replace(/;\s*$/, '').trim()
    }

    return trimmed
}
