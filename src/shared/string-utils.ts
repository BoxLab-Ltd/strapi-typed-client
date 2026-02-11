/**
 * String manipulation utilities for Strapi Types Generator
 * @module shared/string-utils
 */

/**
 * Convert kebab-case or snake_case to camelCase
 * @example
 * toCamelCase('forgot-password') // 'forgotPassword'
 * toCamelCase('create_item') // 'createItem'
 */
export function toCamelCase(str: string): string {
    return str.replace(/[-_]([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Convert first character to lowercase (for method names)
 * @example
 * toLowerFirst('CreateCheckout') // 'createCheckout'
 * toLowerFirst('UpdateCode') // 'updateCode'
 */
export function toLowerFirst(str: string): string {
    return str.charAt(0).toLowerCase() + str.slice(1)
}

/**
 * Convert kebab-case or snake_case to PascalCase
 * @example
 * toPascalCase('team-invitation') // 'TeamInvitation'
 * toPascalCase('custom-upload') // 'CustomUpload'
 */
export function toPascalCase(str: string): string {
    return str
        .split(/[-_]/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('')
}

/**
 * Convert PascalCase or camelCase to kebab-case
 * @example
 * toKebabCase('TeamInvitation') // 'team-invitation'
 * toKebabCase('customUpload') // 'custom-upload'
 */
export function toKebabCase(str: string): string {
    return str
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
        .toLowerCase()
}

/**
 * Convert PascalCase or camelCase to snake_case
 * @example
 * toSnakeCase('TeamInvitation') // 'team_invitation'
 * toSnakeCase('customUpload') // 'custom_upload'
 */
export function toSnakeCase(str: string): string {
    return str
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
        .toLowerCase()
}

/**
 * Capitalize first letter of a string
 * @example
 * capitalize('hello') // 'Hello'
 */
export function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Known abbreviations to preserve in PascalCase conversion
 */
const ABBREVIATIONS = ['AI', 'API', 'UI', 'URL', 'ID', 'HTTP', 'SSE', 'SDK']

/**
 * Convert kebab-case or snake_case to PascalCase, preserving known abbreviations
 * @example
 * toPascalCasePreserve('ai-studio') // 'AIStudio'
 * toPascalCasePreserve('team-invitation') // 'TeamInvitation'
 */
export function toPascalCasePreserve(str: string): string {
    const result = str
        .split(/[-_]/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('')

    let fixed = result
    for (const abbr of ABBREVIATIONS) {
        const pattern = new RegExp(
            `^${abbr[0]}${abbr.slice(1).toLowerCase()}(?=[A-Z]|$)`,
        )
        fixed = fixed.replace(pattern, abbr)
    }

    return fixed
}

/**
 * Extract path parameters from a URL path
 * @example
 * extractPathParams('/items/:id/action') // ['id']
 * extractPathParams('/auth/:provider/callback') // ['provider']
 */
export function extractPathParams(routePath: string): string[] {
    const params: string[] = []
    const regex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g
    let match: RegExpExecArray | null

    while ((match = regex.exec(routePath)) !== null) {
        params.push(match[1])
    }

    return params
}

/**
 * Simple English pluralization
 * @example
 * pluralize('item') // 'items'
 * pluralize('category') // 'categories'
 * pluralize('boss') // 'bosses'
 */
export function pluralize(word: string): string {
    if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) {
        return word.slice(0, -1) + 'ies'
    }
    if (
        word.endsWith('s') ||
        word.endsWith('x') ||
        word.endsWith('z') ||
        word.endsWith('ch') ||
        word.endsWith('sh')
    ) {
        return word + 'es'
    }
    return word + 's'
}
