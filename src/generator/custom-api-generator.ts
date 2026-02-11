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
        const lines: string[] = []

        for (const route of routes) {
            lines.push('')
            lines.push(this.generateCustomMethod(route, isStandalone))
        }

        return lines.join('\n')
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

        const lines: string[] = []
        lines.push('// Custom API namespace types')
        lines.push('')

        for (const typeDef of this.customTypes.typeDefinitions) {
            // Type definitions are already complete (with export), just add them
            lines.push(typeDef)
            lines.push('')
        }

        return lines.join('\n')
    }

    private generateCustomMethod(
        route: ParsedRoute,
        isStandalone: boolean = false,
    ): string {
        const lines: string[] = []

        // Get custom types for this handler
        const customType = this.customTypes?.types.get(route.handler)
        const inputType = customType?.inputType || 'any'
        const outputType = customType?.outputType || 'any'

        // Generate JSDoc comment
        lines.push('  /**')
        lines.push(`   * ${route.method} ${route.path}`)
        lines.push(`   * Handler: ${route.handler}`)
        lines.push('   */')

        // Generate method signature
        const methodName = toCamelCase(route.action)
        const params = this.generateMethodParams(route, inputType)

        lines.push(`  async ${methodName}(${params}): Promise<${outputType}> {`)

        // Generate method body
        const hasBody =
            route.method === 'POST' ||
            route.method === 'PUT' ||
            route.method === 'PATCH'

        // Build full URL with baseURL and /api/ prefix
        if (isStandalone) {
            // For standalone APIs, use the full path directly
            const pathExpression = this.generateStandalonePathExpression(route)
            lines.push(
                `    const url = \`\${this.config.baseURL}/api${pathExpression}\``,
            )
        } else {
            // For collection APIs, combine endpoint with path expression
            const pathExpression = this.generatePathExpression(route)
            lines.push(
                `    const url = \`\${this.config.baseURL}/api/\${this.endpoint}${pathExpression}\``,
            )
        }

        if (hasBody) {
            lines.push(
                `    // If data is FormData, use it directly; otherwise JSON stringify`,
            )
            lines.push(`    const body = data instanceof FormData`)
            lines.push(`      ? data`)
            lines.push(`      : data ? JSON.stringify(data) : undefined`)
            lines.push(``)
            lines.push(
                `    const response = await this.request<StrapiResponse<${outputType}>>(`,
            )
            lines.push(`      url,`)
            lines.push(`      {`)
            lines.push(`        method: '${route.method}',`)
            lines.push(`        body,`)
            lines.push(`      }`)
            lines.push(`    )`)
        } else if (route.method === 'GET') {
            // For GET methods, no need to specify method or options
            lines.push(
                `    const response = await this.request<StrapiResponse<${outputType}>>(url)`,
            )
        } else {
            // For DELETE and other methods without body
            lines.push(
                `    const response = await this.request<StrapiResponse<${outputType}>>(`,
            )
            lines.push(`      url,`)
            lines.push(`      { method: '${route.method}' }`)
            lines.push(`    )`)
        }

        lines.push(`    return response.data`)
        lines.push(`  }`)

        return lines.join('\n')
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
        // Convert '/subscription/assign' to '/subscription/assign'
        // Convert ':param' to '${param}'
        let pathTemplate = route.path

        // Convert :param to ${param}
        pathTemplate = pathTemplate.replace(
            /:([a-zA-Z_][a-zA-Z0-9_]*)/g,
            '${$1}',
        )

        // Return without quotes - will be inserted into template string
        return pathTemplate
    }
}
