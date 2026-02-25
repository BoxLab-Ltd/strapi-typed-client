import { ParsedRoute } from '../parser/routes-parser.js'
import { ParsedCustomTypes } from '../parser/custom-types-parser.js'
import { toCamelCase } from '../shared/string-utils.js'

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
    ): string {
        return routes
            .map(route => '\n' + this.generateCustomMethod(route, isStandalone))
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
    ): string {
        const customType = this.customTypes?.types.get(route.handler)
        const inputType = customType?.inputType || 'any'
        const outputType = customType?.outputType || 'any'
        const methodName = toCamelCase(route.action)
        const params = this.generateMethodParams(route, inputType)
        const hasBody =
            route.method === 'POST' ||
            route.method === 'PUT' ||
            route.method === 'PATCH'

        const urlExpression = isStandalone
            ? `\`\${this.config.baseURL}/api${this.generateStandalonePathExpression(route)}\``
            : `\`\${this.config.baseURL}/api/\${this.endpoint}${this.generatePathExpression(route)}\``

        const bodyBlock = hasBody
            ? `    // If data is FormData, use it directly; otherwise JSON stringify
    const body = data instanceof FormData
      ? data
      : data ? JSON.stringify(data) : undefined

    const response = await this.request<StrapiResponse<${outputType}>>(
      url,
      {
        method: '${route.method}',
        body,
      }
    )`
            : route.method === 'GET'
              ? `    const response = await this.request<StrapiResponse<${outputType}>>(url)`
              : `    const response = await this.request<StrapiResponse<${outputType}>>(
      url,
      { method: '${route.method}' }
    )`

        return `  /**
   * ${route.method} ${route.path}
   * Handler: ${route.handler}
   */
  async ${methodName}(${params}): Promise<${outputType}> {
    const url = ${urlExpression}
${bodyBlock}
    return response.data
  }`
    }

    private generateMethodParams(
        route: ParsedRoute,
        inputType: string = 'any',
    ): string {
        const params: string[] = []

        // Add path parameters
        for (const param of route.params) {
            params.push(`${param}: string`)
        }

        // Add data parameter for POST/PUT/PATCH (support both typed data and FormData)
        if (
            route.method === 'POST' ||
            route.method === 'PUT' ||
            route.method === 'PATCH'
        ) {
            params.push(`data?: ${inputType} | FormData`)
        }

        return params.join(', ')
    }

    private generatePathExpression(route: ParsedRoute): string {
        // Convert path like '/items/:id/increment-run' to '/${id}/increment-run'
        // Remove leading /items if it matches the controller
        let pathTemplate = route.path

        // Remove controller prefix from path
        // e.g., '/items/:id/action' -> '/:id/action'
        const controllerPath = `/${route.controller}s` // pluralize
        if (pathTemplate.startsWith(controllerPath)) {
            pathTemplate = pathTemplate.substring(controllerPath.length)
        } else if (pathTemplate.startsWith(`/${route.controller}`)) {
            pathTemplate = pathTemplate.substring(route.controller.length + 1)
        }

        // Convert :param to ${param}
        pathTemplate = pathTemplate.replace(
            /:([a-zA-Z_][a-zA-Z0-9_]*)/g,
            '${$1}',
        )

        // Return without quotes - will be inserted into template string
        return pathTemplate
    }

    private generateStandalonePathExpression(route: ParsedRoute): string {
        // For standalone routes, use the full path directly
        // Convert ':param' to '${param}'
        let pathTemplate = route.path

        // Add plugin prefix for plugin routes that don't have an empty prefix override
        if (route.pluginName && route.prefix !== '') {
            pathTemplate = `/${route.pluginName}${pathTemplate}`
        }

        // Convert :param to ${param}
        pathTemplate = pathTemplate.replace(
            /:([a-zA-Z_][a-zA-Z0-9_]*)/g,
            '${$1}',
        )

        // Return without quotes - will be inserted into template string
        return pathTemplate
    }
}
