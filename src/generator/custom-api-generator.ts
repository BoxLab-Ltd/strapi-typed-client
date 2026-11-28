import { ParsedRoute } from '../shared/route-types.js'
import { ParsedCustomTypes } from '../shared/custom-types.js'
import {
    toCamelCase,
    toIdentifier,
    toPascalCase,
} from '../shared/string-utils.js'
import { buildMethodParams, buildRequestCall } from './method-signature.js'

/**
 * CollectionAPI / SingleTypeAPI CRUD surface. A custom route whose action
 * matches one of these would override the inherited method with an
 * incompatible signature (TS2416) and shadow the typed CRUD, so on a
 * content-type class its generated method is name-mangled — e.g. a `create`
 * action on the article controller becomes `createArticle`.
 */
const RESERVED_BASE_METHODS = new Set([
    'find',
    'findOne',
    'findWithMeta',
    'create',
    'update',
    'delete',
])

export class CustomApiGenerator {
    private customTypes?: ParsedCustomTypes

    /**
     * Set custom types to use for type generation
     */
    setCustomTypes(customTypes: ParsedCustomTypes): void {
        this.customTypes = customTypes
    }

    /**
     * Generate custom methods for a specific controller
     * These will be added to the corresponding CollectionAPI class or standalone API class
     * @param controller - Controller name
     * @param routes - Routes for this controller
     * @param isStandalone - Whether this is a standalone API (no collection type)
     */
    generateCustomMethods(
        controller: string,
        routes: ParsedRoute[],
        isStandalone: boolean = false,
        contentTypeName?: string,
    ): string {
        return routes
            .map(
                route =>
                    '\n' +
                    this.generateCustomMethod(
                        route,
                        isStandalone,
                        contentTypeName,
                    ),
            )
            .join('\n')
    }

    /**
     * Generate type definitions from API namespace files
     */
    generateTypeDefinitions(): string {
        if (
            !this.customTypes ||
            this.customTypes.typeDefinitions.length === 0
        ) {
            return ''
        }

        return (
            '// Custom API namespace types\n\n' +
            this.customTypes.typeDefinitions.map(td => td + '\n').join('\n')
        )
    }

    private generateCustomMethod(
        route: ParsedRoute,
        isStandalone: boolean = false,
        contentTypeName?: string,
    ): string {
        const customType = this.customTypes?.types.get(route.handler)
        const inputType = customType?.inputType || 'any'
        const outputType = customType?.outputType || 'any'
        let methodName = toIdentifier(toCamelCase(route.action))
        // On a content-type class, a custom action sharing a base CRUD name
        // would emit an incompatible override (TS2416) and hide the typed base
        // method, so mangle it (create -> createArticle). Standalone classes
        // extend BaseAPI, which has no CRUD surface, so they are left as-is.
        if (
            !isStandalone &&
            contentTypeName &&
            RESERVED_BASE_METHODS.has(methodName)
        ) {
            methodName = methodName + toPascalCase(contentTypeName)
        }
        const params = this.generateMethodParams(route, inputType)
        const hasBody =
            route.method === 'POST' ||
            route.method === 'PUT' ||
            route.method === 'PATCH'

        // route.path is the full path under /api; Strapi does not mount custom routes below the collection endpoint
        const urlExpression = `\`\${this.config.baseURL}/api${this.generatePathExpression(route)}\``

        // An undeclared response keeps the historical `.data` unwrap.
        const unwrapData =
            !customType?.outputType || !!customType.responseEnvelope
        const responseType = unwrapData
            ? `StrapiResponse<${outputType}>`
            : outputType
        const bodyBlock = hasBody
            ? `    // If data is FormData, use it directly; otherwise JSON stringify
    const body = data instanceof FormData
      ? data
      : data ? JSON.stringify(data) : undefined

    const response = await ${buildRequestCall({
        responseType,
        init: `{ method: '${route.method}', body }`,
    })}`
            : `    const response = await ${buildRequestCall({
                  responseType,
                  ...(route.method === 'GET'
                      ? {}
                      : { init: `{ method: '${route.method}' }` }),
              })}`

        return `  /**
   * ${route.method} ${route.path}
   * Handler: ${route.handler}
   */
  async ${methodName}(${params}): Promise<${outputType}> {
    const url = ${urlExpression}
${bodyBlock}
    return ${unwrapData ? 'response.data' : 'response'}
  }`
    }

    private generateMethodParams(
        route: ParsedRoute,
        inputType: string = 'any',
    ): string {
        const hasBody =
            route.method === 'POST' ||
            route.method === 'PUT' ||
            route.method === 'PATCH'

        return buildMethodParams({
            pathParams: route.params,
            // Support both typed data and FormData.
            ...(hasBody ? { data: { type: `${inputType} | FormData` } } : {}),
        })
    }

    private generatePathExpression(route: ParsedRoute): string {
        let pathTemplate = route.path

        // Add plugin prefix for plugin routes that don't have an empty prefix override
        if (route.pluginName && route.prefix !== '') {
            pathTemplate = `/${route.pluginName}${pathTemplate}`
        }

        return pathTemplate.replace(
            /:([a-zA-Z_][a-zA-Z0-9_]*)/g,
            '${encodeURIComponent($1)}',
        )
    }
}
