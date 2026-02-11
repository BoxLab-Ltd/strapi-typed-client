import * as ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'
import { toLowerFirst, toPascalCase } from '../shared/index.js'

/**
 * Custom type definition for a specific endpoint
 */
export interface CustomEndpointType {
    handler: string // e.g., 'team-invitation.create'
    inputType?: string // e.g., 'TeamInvitationAPI.CreateRequest'
    outputType?: string // e.g., 'TeamInvitationAPI.CreateResponse'
}

/**
 * Parsed custom types from API namespace files
 */
export interface ParsedCustomTypes {
    types: Map<string, CustomEndpointType> // key: handler (e.g., 'team-invitation.create')
    typeDefinitions: string[] // raw namespace definitions to include in generated file
    namespaceImports: string[] // list of namespace names to import
}

/**
 * Represents a parsed namespace with its types
 */
interface ParsedNamespace {
    name: string // e.g., 'TeamInvitationAPI'
    controller: string // e.g., 'team-invitation' (derived from namespace name)
    types: Map<string, { request?: string; response?: string }> // key: action name (e.g., 'Create')
    fullText: string // full namespace declaration text
}

export class CustomTypesParser {
    /**
     * Parse API namespace files from api/ directory
     */
    parse(inputDir: string): ParsedCustomTypes {
        const result: ParsedCustomTypes = {
            types: new Map(),
            typeDefinitions: [],
            namespaceImports: [],
        }

        const apiDir = path.join(inputDir, 'api')

        if (!fs.existsSync(apiDir)) {
            console.log(
                '⚠️  API types directory not found, using default types (any)',
            )
            return result
        }

        console.log('   Found API types directory, parsing namespaces...')

        // Parse all TypeScript files in api/ directory
        const files = fs
            .readdirSync(apiDir)
            .filter(f => f.endsWith('.ts') && f !== 'index.ts')

        const namespaces: ParsedNamespace[] = []

        for (const file of files) {
            const filePath = path.join(apiDir, file)
            const parsedNamespaces = this.parseNamespaceFile(filePath)
            namespaces.push(...parsedNamespaces)
        }

        // Convert namespaces to handler mappings
        for (const ns of namespaces) {
            // Add namespace to imports
            result.namespaceImports.push(ns.name)

            // Add namespace declaration to type definitions
            result.typeDefinitions.push(ns.fullText)

            // Create handler mappings for each action
            for (const [action, types] of ns.types) {
                // Try multiple handler variations
                const handlers = this.generateHandlerVariations(
                    ns.controller,
                    action,
                )

                for (const handler of handlers) {
                    result.types.set(handler, {
                        handler,
                        inputType: types.request
                            ? `${ns.name}.${types.request}`
                            : undefined,
                        outputType: types.response
                            ? `${ns.name}.${types.response}`
                            : undefined,
                    })
                }
            }
        }

        console.log(
            `   Loaded ${result.types.size} custom endpoint type definitions from ${namespaces.length} namespaces`,
        )

        return result
    }

    /**
     * Parse a single API namespace file
     */
    private parseNamespaceFile(filePath: string): ParsedNamespace[] {
        const sourceCode = fs.readFileSync(filePath, 'utf-8')
        const sourceFile = ts.createSourceFile(
            filePath,
            sourceCode,
            ts.ScriptTarget.Latest,
            true,
        )

        const namespaces: ParsedNamespace[] = []

        const visit = (node: ts.Node) => {
            // Look for: export namespace SomethingAPI { ... }
            if (
                ts.isModuleDeclaration(node) &&
                node.name &&
                ts.isIdentifier(node.name) &&
                node.name.text.endsWith('API')
            ) {
                const namespaceName = node.name.text
                const controller = this.namespaceToController(namespaceName)
                const fullText = node.getText(sourceFile)

                const types = new Map<
                    string,
                    { request?: string; response?: string }
                >()

                // Parse interfaces inside the namespace
                if (node.body && ts.isModuleBlock(node.body)) {
                    for (const statement of node.body.statements) {
                        if (ts.isInterfaceDeclaration(statement)) {
                            const interfaceName = statement.name.text

                            // Determine action name and type based on suffix
                            // Supported patterns:
                            // - SomethingRequest / SomethingResponse
                            // - SomethingFormData (treated as Request, for multipart/form-data endpoints)
                            // - SomethingEvent (treated as Request)
                            // - SomethingInput / SomethingOutput

                            if (interfaceName.endsWith('Request')) {
                                const action = interfaceName.replace(
                                    /Request$/,
                                    '',
                                )
                                const existing = types.get(action) || {}
                                types.set(action, {
                                    ...existing,
                                    request: interfaceName,
                                })
                            } else if (interfaceName.endsWith('Response')) {
                                const action = interfaceName.replace(
                                    /Response$/,
                                    '',
                                )
                                const existing = types.get(action) || {}
                                types.set(action, {
                                    ...existing,
                                    response: interfaceName,
                                })
                            } else if (interfaceName.endsWith('FormData')) {
                                // Treat FormData as Request (for multipart/form-data endpoints)
                                const action = interfaceName.replace(
                                    /FormData$/,
                                    '',
                                )
                                const existing = types.get(action) || {}
                                types.set(action, {
                                    ...existing,
                                    request: interfaceName,
                                })
                            } else if (interfaceName.endsWith('Event')) {
                                // Treat Event as Request (for webhooks)
                                const action = interfaceName.replace(
                                    /Event$/,
                                    '',
                                )
                                const existing = types.get(action) || {}
                                types.set(action, {
                                    ...existing,
                                    request: interfaceName,
                                })
                            } else if (interfaceName.endsWith('Input')) {
                                const action = interfaceName.replace(
                                    /Input$/,
                                    '',
                                )
                                const existing = types.get(action) || {}
                                types.set(action, {
                                    ...existing,
                                    request: interfaceName,
                                })
                            } else if (interfaceName.endsWith('Output')) {
                                const action = interfaceName.replace(
                                    /Output$/,
                                    '',
                                )
                                const existing = types.get(action) || {}
                                types.set(action, {
                                    ...existing,
                                    response: interfaceName,
                                })
                            }
                        }
                    }
                }

                namespaces.push({
                    name: namespaceName,
                    controller,
                    types,
                    fullText,
                })
            }

            ts.forEachChild(node, visit)
        }

        visit(sourceFile)
        return namespaces
    }

    /**
     * Convert namespace name to controller name
     * e.g., 'TeamInvitationAPI' -> 'team-invitation'
     * e.g., 'AIStudioAPI' -> 'ai-studio'
     */
    private namespaceToController(namespaceName: string): string {
        // Remove 'API' suffix
        const withoutSuffix = namespaceName.replace(/API$/, '')

        // Convert PascalCase to kebab-case
        // Special handling for consecutive uppercase letters (acronyms)
        return (
            withoutSuffix
                // First, handle sequences of uppercase letters followed by lowercase (e.g., "AIStudio" -> "AI-Studio")
                .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
                // Then handle normal PascalCase transitions (e.g., "TeamInvitation" -> "Team-Invitation")
                .replace(/([a-z\d])([A-Z])/g, '$1-$2')
                .toLowerCase()
        )
    }

    /**
     * Generate handler variations for flexible matching
     * e.g., controller='checkout', action='CreateCheckout' -> ['checkout.createCheckout', 'checkout.create']
     * e.g., controller='webhook', action='StripeWebhook' -> ['webhook.stripeWebhook', 'webhook.stripe']
     */
    private generateHandlerVariations(
        controller: string,
        action: string,
    ): string[] {
        const handlers: string[] = []
        const controllerPascal = toPascalCase(controller)

        // 1. Direct mapping: action as-is (camelCase)
        handlers.push(`${controller}.${toLowerFirst(action)}`)

        // 2. Remove controller name from action if it's present
        // e.g., 'CreateCheckout' with controller 'checkout' -> 'create'
        if (action.includes(controllerPascal)) {
            const actionWithoutController = action.replace(controllerPascal, '')
            if (actionWithoutController) {
                handlers.push(
                    `${controller}.${toLowerFirst(actionWithoutController)}`,
                )
            }
        }

        // 3. Remove 'Webhook' suffix for webhook handlers
        // e.g., 'StripeWebhook' -> 'stripe', 'YooKassaWebhook' -> 'yooKassa'
        if (action.includes('Webhook')) {
            const actionWithoutWebhook = action.replace('Webhook', '')
            if (actionWithoutWebhook && actionWithoutWebhook !== action) {
                handlers.push(
                    `${controller}.${toLowerFirst(actionWithoutWebhook)}`,
                )
            }
        }

        // 4. Remove other common suffixes
        const commonSuffixes = ['Subscription', 'Member', 'Invitation']
        for (const suffix of commonSuffixes) {
            if (action.includes(suffix)) {
                const actionWithoutSuffix = action.replace(suffix, '')
                if (actionWithoutSuffix && actionWithoutSuffix !== action) {
                    handlers.push(
                        `${controller}.${toLowerFirst(actionWithoutSuffix)}`,
                    )
                }
            }
        }

        return handlers
    }
}
