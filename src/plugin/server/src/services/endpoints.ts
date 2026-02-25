/**
 * Endpoints service for Strapi Types Plugin
 * Extracts custom API routes and their types from Strapi
 */

import * as fs from 'fs'
import * as path from 'path'
import type {
    EndpointType,
    ParsedEndpoint,
    ExtraControllerType,
    EndpointsResponse,
} from '../../../../shared/endpoint-types.js'

export type {
    EndpointType,
    ParsedEndpoint,
    ExtraControllerType,
    EndpointsResponse,
}

interface StrapiRoute {
    method: string
    path: string
    handler: string
    config?: {
        auth?: boolean | { scope?: string[] }
        policies?: string[]
        middlewares?: string[]
        prefix?: string
    }
}

interface StrapiApiEntry {
    routes?: StrapiRoute[] | { routes?: StrapiRoute[] }[]
    contentType?: unknown
    controllers?: unknown
    services?: unknown
}

/**
 * Parse handler string to extract controller and action
 * Supports both short and full Strapi handler formats:
 *   "checkout.buyPlan" -> { controller: "checkout", action: "buyPlan" }
 *   "api::item.item.customAction" -> { controller: "item", action: "customAction" }
 *   "plugin::users-permissions.user.find" -> { controller: "user", action: "find" }
 */
function parseHandler(handler: string): { controller: string; action: string } {
    let normalized = handler

    // Strip "api::xxx." or "plugin::xxx." prefix
    if (normalized.includes('::')) {
        const afterPrefix = normalized.split('::')[1]
        const prefixParts = afterPrefix.split('.')

        normalized = prefixParts.slice(1).join('.')

        if (!normalized) {
            normalized = prefixParts[0]
        }
    }

    const parts = normalized.split('.')
    if (parts.length >= 2) {
        return {
            controller: parts[0],
            action: parts.slice(1).join('.'),
        }
    }
    return {
        controller: normalized,
        action: 'index',
    }
}

/**
 * Extract a balanced block of braces from content starting at position
 */
function extractBalancedBraces(
    content: string,
    startPos: number,
): string | null {
    if (content[startPos] !== '{') return null

    let depth = 0
    let i = startPos

    while (i < content.length) {
        if (content[i] === '{') depth++
        else if (content[i] === '}') depth--

        if (depth === 0) {
            return content.slice(startPos + 1, i) // Return content inside braces
        }
        i++
    }

    return null
}

/**
 * Extract Endpoints interface from a TypeScript controller file
 */
function parseEndpointsFromFile(
    filePath: string,
): Record<string, EndpointType> | null {
    try {
        if (!fs.existsSync(filePath)) {
            return null
        }

        const content = fs.readFileSync(filePath, 'utf-8')

        // Find "export interface Endpoints {"
        const startMatch = content.match(/export\s+interface\s+Endpoints\s*\{/)
        if (!startMatch || startMatch.index === undefined) {
            return null
        }

        const braceStart = startMatch.index + startMatch[0].length - 1
        const endpointsBlock = extractBalancedBraces(content, braceStart)

        if (!endpointsBlock) {
            return null
        }

        const result: Record<string, EndpointType> = {}

        // Find each action: "actionName: {"
        const actionStartPattern = /(\w+)\s*:\s*\{/g
        let actionMatch

        while (
            (actionMatch = actionStartPattern.exec(endpointsBlock)) !== null
        ) {
            const actionName = actionMatch[1]
            const actionBraceStart =
                actionMatch.index + actionMatch[0].length - 1
            const actionBlock = extractBalancedBraces(
                endpointsBlock,
                actionBraceStart,
            )

            if (!actionBlock) continue

            const types: EndpointType = {}

            // Extract body type - handle nested braces
            const bodyStartMatch = actionBlock.match(/body\s*[?]?\s*:\s*/)
            if (bodyStartMatch && bodyStartMatch.index !== undefined) {
                const afterBody = actionBlock.slice(
                    bodyStartMatch.index + bodyStartMatch[0].length,
                )
                if (afterBody.startsWith('{')) {
                    const bodyBlock = extractBalancedBraces(afterBody, 0)
                    if (bodyBlock) {
                        types.body = `{ ${bodyBlock} }`
                    }
                } else {
                    // Simple type like "void" or "string"
                    const simpleMatch = afterBody.match(/^([^;\n}]+)/)
                    if (simpleMatch) {
                        types.body = simpleMatch[1].trim()
                    }
                }
            }

            // Extract response type - handle nested braces
            const responseStartMatch = actionBlock.match(
                /response\s*[?]?\s*:\s*/,
            )
            if (responseStartMatch && responseStartMatch.index !== undefined) {
                const afterResponse = actionBlock.slice(
                    responseStartMatch.index + responseStartMatch[0].length,
                )
                if (afterResponse.startsWith('{')) {
                    const responseBlock = extractBalancedBraces(
                        afterResponse,
                        0,
                    )
                    if (responseBlock) {
                        types.response = `{ ${responseBlock} }`
                    }
                } else {
                    const simpleMatch = afterResponse.match(/^([^;\n}]+)/)
                    if (simpleMatch) {
                        types.response = simpleMatch[1].trim()
                    }
                }
            }

            // Extract params type
            const paramsStartMatch = actionBlock.match(/params\s*[?]?\s*:\s*/)
            if (paramsStartMatch && paramsStartMatch.index !== undefined) {
                const afterParams = actionBlock.slice(
                    paramsStartMatch.index + paramsStartMatch[0].length,
                )
                if (afterParams.startsWith('{')) {
                    const paramsBlock = extractBalancedBraces(afterParams, 0)
                    if (paramsBlock) {
                        types.params = `{ ${paramsBlock} }`
                    }
                } else {
                    const simpleMatch = afterParams.match(/^([^;\n}]+)/)
                    if (simpleMatch) {
                        types.params = simpleMatch[1].trim()
                    }
                }
            }

            // Extract query type
            const queryStartMatch = actionBlock.match(/query\s*[?]?\s*:\s*/)
            if (queryStartMatch && queryStartMatch.index !== undefined) {
                const afterQuery = actionBlock.slice(
                    queryStartMatch.index + queryStartMatch[0].length,
                )
                if (afterQuery.startsWith('{')) {
                    const queryBlock = extractBalancedBraces(afterQuery, 0)
                    if (queryBlock) {
                        types.query = `{ ${queryBlock} }`
                    }
                } else {
                    const simpleMatch = afterQuery.match(/^([^;\n}]+)/)
                    if (simpleMatch) {
                        types.query = simpleMatch[1].trim()
                    }
                }
            }

            if (Object.keys(types).length > 0) {
                result[actionName] = types
            }
        }

        return Object.keys(result).length > 0 ? result : null
    } catch {
        return null
    }
}

/**
 * Extract standalone exported types from a controller file (not part of Endpoints interface).
 * e.g., `export type SSEEvent = { type: 'connected' } | { type: 'progress', ... }`
 */
function parseExtraTypesFromFile(
    filePath: string,
    controller: string,
): ExtraControllerType[] {
    try {
        if (!fs.existsSync(filePath)) {
            return []
        }

        const content = fs.readFileSync(filePath, 'utf-8')
        const extraTypes: ExtraControllerType[] = []

        // Pattern 1: export type Name = ...
        const typePattern = /export\s+type\s+(\w+)\s*=\s*/g
        let match

        while ((match = typePattern.exec(content)) !== null) {
            const typeName = match[1]
            // Skip the Endpoints interface (it's handled separately)
            if (typeName === 'Endpoints') continue

            const afterEquals = match.index + match[0].length
            const restOfContent = content.slice(afterEquals)

            // Find end of type definition: next top-level declaration or end of file
            const endPattern =
                /\n(?=export\s|const\s|let\s|var\s|function\s|class\s|default\s|import\s)/
            const endMatch = restOfContent.match(endPattern)

            let typeDefinition: string
            if (endMatch && endMatch.index !== undefined) {
                typeDefinition = restOfContent.slice(0, endMatch.index).trim()
            } else {
                typeDefinition = restOfContent.trim()
            }

            extraTypes.push({ controller, typeName, typeDefinition })
        }

        // Pattern 2: export interface Name { ... } (excluding Endpoints)
        const interfacePattern = /export\s+interface\s+(\w+)\s*\{/g

        while ((match = interfacePattern.exec(content)) !== null) {
            const typeName = match[1]
            if (typeName === 'Endpoints') continue

            const braceStart = match.index + match[0].length - 1
            const block = extractBalancedBraces(content, braceStart)

            if (block) {
                extraTypes.push({
                    controller,
                    typeName,
                    typeDefinition: `{ ${block} }`,
                })
            }
        }

        return extraTypes
    } catch {
        return []
    }
}

/**
 * Find controller file for an API
 */
function findControllerFile(
    strapiDir: string,
    apiName: string,
    controllerName: string,
): string | null {
    const possiblePaths = [
        // Standard Strapi structure
        path.join(
            strapiDir,
            'src',
            'api',
            apiName,
            'controllers',
            `${controllerName}.ts`,
        ),
        path.join(
            strapiDir,
            'src',
            'api',
            apiName,
            'controllers',
            `${controllerName}.js`,
        ),
        // Index file
        path.join(strapiDir, 'src', 'api', apiName, 'controllers', 'index.ts'),
        path.join(strapiDir, 'src', 'api', apiName, 'controllers', 'index.js'),
        // Plugin structure
        path.join(
            strapiDir,
            'src',
            'plugins',
            apiName,
            'server',
            'controllers',
            `${controllerName}.ts`,
        ),
        path.join(
            strapiDir,
            'src',
            'plugins',
            apiName,
            'server',
            'controllers',
            `${controllerName}.js`,
        ),
    ]

    for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
            return filePath
        }
    }

    return null
}

export default ({ strapi }: { strapi: any }) => ({
    /**
     * Extract extra (standalone) exported types from all API controller files.
     * These are types like `export type SSEEvent = ...` that are not part of the Endpoints interface.
     */
    extractExtraTypes(strapiDir: string): ExtraControllerType[] {
        const extraTypes: ExtraControllerType[] = []
        const apiDir = path.join(strapiDir, 'src', 'api')

        if (!fs.existsSync(apiDir)) {
            return extraTypes
        }

        const apiNames = fs.readdirSync(apiDir).filter(name => {
            const stat = fs.statSync(path.join(apiDir, name))
            return stat.isDirectory()
        })

        const seen = new Set<string>() // deduplicate by controller+typeName

        for (const apiName of apiNames) {
            const controllersDir = path.join(apiDir, apiName, 'controllers')
            if (!fs.existsSync(controllersDir)) continue

            const controllerFiles = fs
                .readdirSync(controllersDir)
                .filter(f => f.endsWith('.ts'))

            for (const file of controllerFiles) {
                const filePath = path.join(controllersDir, file)
                const controllerName = file.replace(/\.ts$/, '')
                const types = parseExtraTypesFromFile(filePath, controllerName)

                for (const t of types) {
                    const key = `${t.controller}:${t.typeName}`
                    if (!seen.has(key)) {
                        seen.add(key)
                        extraTypes.push(t)
                    }
                }
            }
        }

        if (extraTypes.length > 0) {
            strapi.log.debug(
                `[strapi-types] Found ${extraTypes.length} extra types: ${extraTypes.map(t => `${t.controller}.${t.typeName}`).join(', ')}`,
            )
        }

        return extraTypes
    },

    /**
     * Extract routes from filesystem (fallback when strapi.api is empty)
     */
    extractRoutesFromFiles(strapiDir: string): {
        endpoints: ParsedEndpoint[]
        extraTypes: ExtraControllerType[]
    } {
        const endpoints: ParsedEndpoint[] = []
        const apiDir = path.join(strapiDir, 'src', 'api')

        if (!fs.existsSync(apiDir)) {
            return { endpoints, extraTypes: [] }
        }

        const apiNames = fs.readdirSync(apiDir).filter(name => {
            const stat = fs.statSync(path.join(apiDir, name))
            return stat.isDirectory()
        })

        for (const apiName of apiNames) {
            const routesDir = path.join(apiDir, apiName, 'routes')
            if (!fs.existsSync(routesDir)) continue

            const routeFiles = fs
                .readdirSync(routesDir)
                .filter(f => f.endsWith('.ts') || f.endsWith('.js'))

            for (const routeFile of routeFiles) {
                const filePath = path.join(routesDir, routeFile)
                const routes = this.parseRouteFile(filePath, apiName)
                endpoints.push(...routes)
            }
        }

        const extraTypes = this.extractExtraTypes(strapiDir)
        return { endpoints, extraTypes }
    },

    /**
     * Parse a route file and extract routes
     */
    parseRouteFile(filePath: string, _apiName: string): ParsedEndpoint[] {
        const endpoints: ParsedEndpoint[] = []

        try {
            const content = fs.readFileSync(filePath, 'utf-8')

            // Match route definitions: { method: 'POST', path: '/...', handler: '...' }
            const routePattern =
                /\{\s*method\s*:\s*['"](\w+)['"]\s*,\s*path\s*:\s*['"]([^'"]+)['"]\s*,\s*handler\s*:\s*['"]([^'"]+)['"]/g

            // Cache for parsed controller types per controller name
            const controllerTypesCache: Record<
                string,
                Record<string, EndpointType> | null
            > = {}

            // Route file is at: src/api/{apiName}/routes/{file}.ts
            // Controller is at: src/api/{apiName}/controllers/{controller}.ts
            const apiDir = path.dirname(path.dirname(filePath)) // src/api/{apiName}

            let match
            while ((match = routePattern.exec(content)) !== null) {
                const method = match[1].toUpperCase()
                const routePath = match[2]
                const handler = match[3]

                const { controller, action } = parseHandler(handler)

                // Try to find types from controller file
                let types: EndpointType | undefined

                if (!(controller in controllerTypesCache)) {
                    // Look for controller file directly in the api directory
                    const possibleControllerPaths = [
                        path.join(apiDir, 'controllers', `${controller}.ts`),
                        path.join(apiDir, 'controllers', `${controller}.js`),
                        path.join(apiDir, 'controllers', 'index.ts'),
                        path.join(apiDir, 'controllers', 'index.js'),
                    ]

                    let foundControllerPath: string | null = null
                    for (const cp of possibleControllerPaths) {
                        if (fs.existsSync(cp)) {
                            foundControllerPath = cp
                            break
                        }
                    }

                    if (foundControllerPath) {
                        strapi.log.debug(
                            `[strapi-types] Found controller: ${foundControllerPath}`,
                        )
                        controllerTypesCache[controller] =
                            parseEndpointsFromFile(foundControllerPath)
                        if (controllerTypesCache[controller]) {
                            strapi.log.debug(
                                `[strapi-types] Parsed types for ${controller}: ${Object.keys(controllerTypesCache[controller]!).join(', ')}`,
                            )
                        }
                    } else {
                        strapi.log.debug(
                            `[strapi-types] Controller not found for ${controller} in ${apiDir}`,
                        )
                        controllerTypesCache[controller] = null
                    }
                }

                if (
                    controllerTypesCache[controller] &&
                    controllerTypesCache[controller]![action]
                ) {
                    types = controllerTypesCache[controller]![action]
                }

                endpoints.push({
                    method,
                    path: routePath.startsWith('/')
                        ? routePath
                        : `/${routePath}`,
                    handler,
                    controller,
                    action,
                    types,
                })
            }
        } catch (error) {
            strapi.log.debug(
                `[strapi-types] Error parsing route file ${filePath}: ${error}`,
            )
        }

        return endpoints
    },

    /**
     * Extract all custom API endpoints from Strapi
     */
    extractEndpoints(): EndpointsResponse {
        const endpoints: ParsedEndpoint[] = []
        const strapiDir = strapi.dirs?.app?.root || process.cwd()

        // Log available strapi keys to understand structure
        const strapiKeys = Object.keys(strapi).filter(k => !k.startsWith('_'))
        strapi.log.debug(
            `[strapi-types] Strapi top-level keys: ${strapiKeys.slice(0, 20).join(', ')}...`,
        )

        // Check various possible locations for routes
        if (strapi.api) {
            strapi.log.debug(
                `[strapi-types] strapi.api keys: ${Object.keys(strapi.api).join(', ')}`,
            )
        } else {
            strapi.log.debug('[strapi-types] strapi.api is undefined/empty')
        }

        if (strapi.apis) {
            strapi.log.debug(
                `[strapi-types] strapi.apis keys: ${Object.keys(strapi.apis).join(', ')}`,
            )
        }

        if (strapi.server?.routes) {
            strapi.log.debug(`[strapi-types] strapi.server.routes exists`)
        }

        // Try to get routes from content-types
        const contentTypeKeys = Object.keys(strapi.contentTypes || {}).filter(
            k => k.startsWith('api::'),
        )
        strapi.log.debug(
            `[strapi-types] API content types: ${contentTypeKeys.join(', ')}`,
        )

        // Iterate over all APIs
        if (!strapi.api || Object.keys(strapi.api).length === 0) {
            strapi.log.debug(
                '[strapi-types] strapi.api is empty, trying alternative methods',
            )

            // Alternative: Read routes from filesystem
            const fromFiles = this.extractRoutesFromFiles(strapiDir)
            if (fromFiles.endpoints.length > 0) {
                strapi.log.debug(
                    `[strapi-types] Found ${fromFiles.endpoints.length} routes from files`,
                )

                // Also extract plugin routes
                this.extractPluginRoutes(
                    fromFiles.endpoints,
                    'users-permissions',
                )

                return {
                    endpoints: fromFiles.endpoints,
                    extraTypes: fromFiles.extraTypes,
                    count: fromFiles.endpoints.length,
                }
            }

            // Even with no API routes, extract plugin routes
            this.extractPluginRoutes(endpoints, 'users-permissions')
            if (endpoints.length > 0) {
                const extraTypes = this.extractExtraTypes(strapiDir)
                return {
                    endpoints,
                    extraTypes,
                    count: endpoints.length,
                }
            }

            return { endpoints: [], extraTypes: [], count: 0 }
        }

        strapi.log.debug(
            `[strapi-types] Found ${Object.keys(strapi.api).length} APIs: ${Object.keys(strapi.api).join(', ')}`,
        )

        for (const [apiName, api] of Object.entries(strapi.api) as [
            string,
            StrapiApiEntry,
        ][]) {
            // Log the structure of each API
            const apiKeys = Object.keys(api)
            strapi.log.debug(
                `[strapi-types] API "${apiName}" keys: ${apiKeys.join(', ')}`,
            )

            // Deep inspect routes structure
            if (api.routes) {
                strapi.log.debug(
                    `[strapi-types] API "${apiName}" routes type: ${typeof api.routes}, isArray: ${Array.isArray(api.routes)}`,
                )
                if (
                    typeof api.routes === 'object' &&
                    !Array.isArray(api.routes)
                ) {
                    strapi.log.debug(
                        `[strapi-types] API "${apiName}" routes object keys: ${Object.keys(api.routes).join(', ')}`,
                    )
                }
                if (Array.isArray(api.routes) && api.routes.length > 0) {
                    strapi.log.debug(
                        `[strapi-types] API "${apiName}" first route item keys: ${Object.keys(api.routes[0]).join(', ')}`,
                    )
                }
            }

            // Try different ways to access routes
            let routes: StrapiRoute[] = []

            // Method 1: Direct routes array with route objects
            if (api.routes && Array.isArray(api.routes)) {
                for (const item of api.routes) {
                    if ('routes' in item && Array.isArray(item.routes)) {
                        // Nested routes: { type: 'content-api', routes: [...] }
                        routes = routes.concat(item.routes)
                    } else if ('method' in item && 'path' in item) {
                        // Direct route object
                        routes.push(item as StrapiRoute)
                    }
                }
            }

            // Method 2: Routes as object with named groups
            if (
                api.routes &&
                typeof api.routes === 'object' &&
                !Array.isArray(api.routes)
            ) {
                for (const [groupName, group] of Object.entries(api.routes)) {
                    strapi.log.debug(
                        `[strapi-types] API "${apiName}" route group "${groupName}" type: ${typeof group}`,
                    )
                    if (group && typeof group === 'object') {
                        if (
                            'routes' in group &&
                            Array.isArray((group as any).routes)
                        ) {
                            routes = routes.concat((group as any).routes)
                        }
                    }
                }
            }

            // Method 3: Check for routes in config
            if (routes.length === 0 && (api as any).config?.routes) {
                const configRoutes = (api as any).config.routes
                if (Array.isArray(configRoutes)) {
                    routes = configRoutes
                }
            }

            strapi.log.debug(
                `[strapi-types] API "${apiName}" extracted ${routes.length} routes`,
            )

            // Cache for parsed controller types
            const controllerTypesCache: Record<
                string,
                Record<string, EndpointType> | null
            > = {}

            for (const route of routes) {
                // Skip core CRUD routes (those without custom handlers)
                if (!route.handler || typeof route.handler !== 'string') {
                    continue
                }

                const { controller, action } = parseHandler(route.handler)

                // Try to find and parse types
                let types: EndpointType | undefined

                if (!controllerTypesCache[controller]) {
                    const controllerFile = findControllerFile(
                        strapiDir,
                        apiName,
                        controller,
                    )
                    if (controllerFile) {
                        controllerTypesCache[controller] =
                            parseEndpointsFromFile(controllerFile)
                    } else {
                        controllerTypesCache[controller] = null
                    }
                }

                if (
                    controllerTypesCache[controller] &&
                    controllerTypesCache[controller]![action]
                ) {
                    types = controllerTypesCache[controller]![action]
                }

                endpoints.push({
                    method: route.method.toUpperCase(),
                    path: route.path.startsWith('/')
                        ? route.path
                        : `/${route.path}`,
                    handler: route.handler,
                    controller,
                    action,
                    types,
                })
            }
        }

        // Extract routes from users-permissions plugin
        this.extractPluginRoutes(endpoints, 'users-permissions')

        // Sort endpoints by path for consistent output
        endpoints.sort((a, b) => {
            const pathCompare = a.path.localeCompare(b.path)
            if (pathCompare !== 0) return pathCompare
            return a.method.localeCompare(b.method)
        })

        // Extract extra types from controller files
        const extraTypes = this.extractExtraTypes(strapiDir)

        return {
            endpoints,
            extraTypes,
            count: endpoints.length,
        }
    },

    /**
     * Extract routes from a Strapi plugin (e.g., users-permissions)
     * and append them to the endpoints array with pluginName and prefix set.
     */
    extractPluginRoutes(endpoints: ParsedEndpoint[], pluginName: string): void {
        try {
            const plugin = strapi.plugin(pluginName)
            if (!plugin) return

            // Access plugin routes — Strapi stores them in plugin.routes['content-api']
            const contentApiRoutes = plugin.routes?.['content-api']
            if (!contentApiRoutes) return

            let routes: StrapiRoute[] = []
            if (Array.isArray(contentApiRoutes)) {
                routes = contentApiRoutes
            } else if (
                contentApiRoutes.routes &&
                Array.isArray(contentApiRoutes.routes)
            ) {
                routes = contentApiRoutes.routes
            }

            strapi.log.debug(
                `[strapi-types] Plugin "${pluginName}" has ${routes.length} content-api routes`,
            )

            for (const route of routes) {
                if (!route.handler || typeof route.handler !== 'string')
                    continue

                // Normalize handler to full uid format: plugin::users-permissions.role.find
                const fullHandler = route.handler.includes('::')
                    ? route.handler
                    : `plugin::${pluginName}.${route.handler}`
                const { controller, action } = parseHandler(fullHandler)
                const prefix = route.config?.prefix

                endpoints.push({
                    method: route.method.toUpperCase(),
                    path: route.path.startsWith('/')
                        ? route.path
                        : `/${route.path}`,
                    handler: fullHandler,
                    controller,
                    action,
                    pluginName,
                    ...(prefix !== undefined && { prefix }),
                })
            }
        } catch (error) {
            strapi.log.debug(
                `[strapi-types] Error extracting plugin routes for ${pluginName}: ${error}`,
            )
        }
    },

    /**
     * Get endpoints for a specific API
     */
    getEndpointsForApi(apiName: string): ParsedEndpoint[] {
        const { endpoints } = this.extractEndpoints()
        return endpoints.filter(
            e => e.controller === apiName || e.path.startsWith(`/${apiName}`),
        )
    },
})
