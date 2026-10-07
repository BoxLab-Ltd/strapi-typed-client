/**
 * Endpoints service for Strapi Types Plugin
 * Extracts custom API routes and their types from Strapi
 */

import * as fs from 'fs'
import * as path from 'path'
import {
    parseControllerSource,
    type ParsedControllerSource,
} from './endpoint-parser.js'
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

type TypeScriptModule = typeof import('typescript')

let typescriptModule: Promise<TypeScriptModule | null> | undefined

function loadTypeScript(): Promise<TypeScriptModule | null> {
    typescriptModule ??= import('typescript').then(
        mod => (mod as { default?: TypeScriptModule }).default ?? mod,
        () => null,
    )
    return typescriptModule
}

const controllerCache = new Map<
    string,
    { mtimeMs: number; size: number; parsed: ParsedControllerSource }
>()

const EMPTY_CONTROLLER: ParsedControllerSource = {
    endpoints: null,
    extraTypes: [],
    syntaxError: false,
}

// Runs on every schema and hash request, so unchanged files are served from cache.
// The cache holds the parse without a controller name: one file (controllers/index.ts)
// can be read for several handlers, and its extra types must keep their own name.
async function readControllerTypes(
    filePath: string,
    controller: string,
    warn: (message: string) => void = () => {},
): Promise<ParsedControllerSource> {
    if (!/\.tsx?$/.test(filePath)) return EMPTY_CONTROLLER
    try {
        const { mtimeMs, size } = fs.statSync(filePath)
        let parsed = controllerCache.get(filePath)
        if (!parsed || parsed.mtimeMs !== mtimeMs || parsed.size !== size) {
            parsed = { mtimeMs, size, parsed: await parseFile(filePath) }
            controllerCache.set(filePath, parsed)
            if (parsed.parsed.syntaxError) {
                warn(
                    `[strapi-types] ${filePath} has a syntax error; its Endpoints types are skipped until it parses`,
                )
            }
        }
        return {
            ...parsed.parsed,
            extraTypes: parsed.parsed.extraTypes.map(t => ({
                ...t,
                controller,
            })),
        }
    } catch {
        return EMPTY_CONTROLLER
    }
}

async function parseFile(filePath: string): Promise<ParsedControllerSource> {
    const source = fs.readFileSync(filePath, 'utf-8')
    if (!/export\s+(type|interface)\s/.test(source)) return EMPTY_CONTROLLER
    const ts = await loadTypeScript()
    return ts
        ? parseControllerSource(ts, source, '', filePath)
        : EMPTY_CONTROLLER
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

export default ({ strapi }: { strapi: any }) => {
    const warnLog = (message: string) => strapi.log.warn(message)
    return {
        /**
         * Extract extra (standalone) exported types from all API controller files.
         * These are types like `export type SSEEvent = ...` that are not part of the Endpoints interface.
         */
        async extractExtraTypes(
            strapiDir: string,
        ): Promise<ExtraControllerType[]> {
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
                    const { extraTypes: types } = await readControllerTypes(
                        filePath,
                        controllerName,
                        warnLog,
                    )

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
        async extractRoutesFromFiles(strapiDir: string): Promise<{
            endpoints: ParsedEndpoint[]
            extraTypes: ExtraControllerType[]
        }> {
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
                    const routes = await this.parseRouteFile(filePath, apiName)
                    endpoints.push(...routes)
                }
            }

            const extraTypes = await this.extractExtraTypes(strapiDir)
            return { endpoints, extraTypes }
        },

        /**
         * Parse a route file and extract routes
         */
        async parseRouteFile(
            filePath: string,
            _apiName: string,
        ): Promise<ParsedEndpoint[]> {
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
                            path.join(
                                apiDir,
                                'controllers',
                                `${controller}.ts`,
                            ),
                            path.join(
                                apiDir,
                                'controllers',
                                `${controller}.js`,
                            ),
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
                            controllerTypesCache[controller] = (
                                await readControllerTypes(
                                    foundControllerPath,
                                    controller,
                                    warnLog,
                                )
                            ).endpoints
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
        async extractEndpoints(): Promise<EndpointsResponse> {
            const endpoints: ParsedEndpoint[] = []
            const strapiDir = strapi.dirs?.app?.root || process.cwd()

            // Log available strapi keys to understand structure
            const strapiKeys = Object.keys(strapi).filter(
                k => !k.startsWith('_'),
            )
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
            const contentTypeKeys = Object.keys(
                strapi.contentTypes || {},
            ).filter(k => k.startsWith('api::'))
            strapi.log.debug(
                `[strapi-types] API content types: ${contentTypeKeys.join(', ')}`,
            )

            // Iterate over all APIs
            if (!strapi.api || Object.keys(strapi.api).length === 0) {
                strapi.log.debug(
                    '[strapi-types] strapi.api is empty, trying alternative methods',
                )

                // Alternative: Read routes from filesystem
                const fromFiles = await this.extractRoutesFromFiles(strapiDir)
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
                    const extraTypes = await this.extractExtraTypes(strapiDir)
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
                    for (const [groupName, group] of Object.entries(
                        api.routes,
                    )) {
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

                    if (!(controller in controllerTypesCache)) {
                        const controllerFile = findControllerFile(
                            strapiDir,
                            apiName,
                            controller,
                        )
                        if (controllerFile) {
                            controllerTypesCache[controller] = (
                                await readControllerTypes(
                                    controllerFile,
                                    controller,
                                    warnLog,
                                )
                            ).endpoints
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
            const extraTypes = await this.extractExtraTypes(strapiDir)

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
        extractPluginRoutes(
            endpoints: ParsedEndpoint[],
            pluginName: string,
        ): void {
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
        async getEndpointsForApi(apiName: string): Promise<ParsedEndpoint[]> {
            const { endpoints } = await this.extractEndpoints()
            return endpoints.filter(
                e =>
                    e.controller === apiName ||
                    e.path.startsWith(`/${apiName}`),
            )
        },
    }
}
