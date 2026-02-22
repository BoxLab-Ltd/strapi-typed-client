import * as ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'

export interface ParsedRoute {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    path: string
    handler: string
    controller: string // extracted from handler (e.g., 'item' from 'item.incrementRun')
    action: string // extracted from handler (e.g., 'incrementRun' from 'item.incrementRun')
    params: string[] // extracted from path (e.g., ['id'] from '/items/:id/action')
}

export interface ParsedRoutes {
    byController: Map<string, ParsedRoute[]> // grouped by controller name
    all: ParsedRoute[]
}

export class RoutesParser {
    parse(routesDir: string): ParsedRoutes {
        const result: ParsedRoutes = {
            byController: new Map(),
            all: [],
        }

        // Check if routes directory exists
        if (!fs.existsSync(routesDir)) {
            console.log(
                '⚠️  Routes directory not found, skipping custom routes parsing',
            )
            return result
        }

        // Parse TypeScript files from API routes
        const tsFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.ts'))
        for (const file of tsFiles) {
            const filePath = path.join(routesDir, file)
            const routes = this.parseFile(filePath)

            for (const route of routes) {
                result.all.push(route)

                if (!result.byController.has(route.controller)) {
                    result.byController.set(route.controller, [])
                }
                result.byController.get(route.controller)!.push(route)
            }
        }

        // Parse JavaScript files from plugin routes
        const pluginsDir = path.join(routesDir, 'plugins')
        if (fs.existsSync(pluginsDir)) {
            const jsFiles = fs
                .readdirSync(pluginsDir)
                .filter(f => f.endsWith('.js'))
            for (const file of jsFiles) {
                const filePath = path.join(pluginsDir, file)
                const routes = this.parseJavaScriptFile(filePath)

                for (const route of routes) {
                    result.all.push(route)

                    if (!result.byController.has(route.controller)) {
                        result.byController.set(route.controller, [])
                    }
                    result.byController.get(route.controller)!.push(route)
                }
            }
        }

        return result
    }

    private parseFile(filePath: string): ParsedRoute[] {
        const sourceCode = fs.readFileSync(filePath, 'utf-8')
        const sourceFile = ts.createSourceFile(
            filePath,
            sourceCode,
            ts.ScriptTarget.Latest,
            true,
        )

        const routes: ParsedRoute[] = []

        const visit = (node: ts.Node) => {
            // Look for: export default { routes: [...] }
            if (
                ts.isExportAssignment(node) &&
                ts.isObjectLiteralExpression(node.expression)
            ) {
                const routesProperty = node.expression.properties.find(
                    p =>
                        ts.isPropertyAssignment(p) &&
                        ts.isIdentifier(p.name) &&
                        p.name.text === 'routes',
                ) as ts.PropertyAssignment | undefined

                if (
                    routesProperty &&
                    ts.isArrayLiteralExpression(routesProperty.initializer)
                ) {
                    for (const element of routesProperty.initializer.elements) {
                        if (ts.isObjectLiteralExpression(element)) {
                            const route = this.parseRouteObject(element)
                            if (route) {
                                routes.push(route)
                            }
                        }
                    }
                }
            }

            ts.forEachChild(node, visit)
        }

        visit(sourceFile)
        return routes
    }

    private parseRouteObject(
        obj: ts.ObjectLiteralExpression,
    ): ParsedRoute | null {
        let method: string | undefined
        let pathValue: string | undefined
        let handler: string | undefined

        for (const prop of obj.properties) {
            if (!ts.isPropertyAssignment(prop)) continue
            if (!ts.isIdentifier(prop.name)) continue

            const propName = prop.name.text
            let value: string | undefined

            if (ts.isStringLiteral(prop.initializer)) {
                value = prop.initializer.text
            }

            if (propName === 'method' && value) {
                method = value
            } else if (propName === 'path' && value) {
                pathValue = value
            } else if (propName === 'handler' && value) {
                handler = value
            }
        }

        if (!method || !pathValue || !handler) {
            return null
        }

        // Parse handler: strip "api::xxx." or "plugin::xxx." prefix if present
        let normalizedHandler = handler
        if (normalizedHandler.includes('::')) {
            const afterPrefix = normalizedHandler.split('::')[1]
            const prefixParts = afterPrefix.split('.')
            normalizedHandler = prefixParts.slice(1).join('.') || prefixParts[0]
        }

        const [controller, action] = normalizedHandler.split('.')
        if (!controller || !action) {
            return null
        }

        // Extract path params: '/items/:id/action' → ['id']
        const params = this.extractPathParams(pathValue)

        return {
            method: method as ParsedRoute['method'],
            path: pathValue,
            handler,
            controller,
            action,
            params,
        }
    }

    private parseJavaScriptFile(filePath: string): ParsedRoute[] {
        const sourceCode = fs.readFileSync(filePath, 'utf-8')
        const sourceFile = ts.createSourceFile(
            filePath,
            sourceCode,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.JS,
        )

        const routes: ParsedRoute[] = []

        const visit = (node: ts.Node) => {
            // Look for: module.exports = (strapi) => { return [...] } or module.exports = (strapi) => [...]
            if (ts.isExpressionStatement(node)) {
                const expr = node.expression
                if (
                    ts.isBinaryExpression(expr) &&
                    expr.operatorToken.kind === ts.SyntaxKind.EqualsToken
                ) {
                    // Check if left side is module.exports
                    const left = expr.left
                    if (
                        ts.isPropertyAccessExpression(left) &&
                        ts.isIdentifier(left.expression) &&
                        left.expression.text === 'module' &&
                        left.name.text === 'exports'
                    ) {
                        // Right side should be an arrow function
                        const right = expr.right
                        if (ts.isArrowFunction(right)) {
                            // Find the return statement or direct array expression
                            const body = right.body

                            if (ts.isBlock(body)) {
                                // Function with block: (strapi) => { return [...] }
                                body.statements.forEach(stmt => {
                                    if (
                                        ts.isReturnStatement(stmt) &&
                                        stmt.expression
                                    ) {
                                        if (
                                            ts.isArrayLiteralExpression(
                                                stmt.expression,
                                            )
                                        ) {
                                            this.parseRoutesArray(
                                                stmt.expression,
                                                routes,
                                            )
                                        }
                                    }
                                })
                            } else if (ts.isArrayLiteralExpression(body)) {
                                // Direct array: (strapi) => [...]
                                this.parseRoutesArray(body, routes)
                            }
                        }
                    }
                }
            }

            ts.forEachChild(node, visit)
        }

        visit(sourceFile)
        return routes
    }

    private parseRoutesArray(
        arrayExpr: ts.ArrayLiteralExpression,
        routes: ParsedRoute[],
    ) {
        for (const element of arrayExpr.elements) {
            if (ts.isObjectLiteralExpression(element)) {
                const route = this.parseRouteObject(element)
                if (route) {
                    routes.push(route)
                }
            }
        }
    }

    private extractPathParams(pathValue: string): string[] {
        const params: string[] = []
        const regex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g
        let match: RegExpExecArray | null

        while ((match = regex.exec(pathValue)) !== null) {
            params.push(match[1])
        }

        return params
    }
}
