/**
 * Naming utilities for Strapi Types Generator
 * Handles conversion of Strapi-specific naming patterns to TypeScript
 * @module shared/naming-utils
 */

import { toPascalCase, pluralize, toKebabCase } from './string-utils.js'

/**
 * Convert Strapi component UID to TypeScript interface name
 * @example
 * convertComponentName('shared.feature') // 'SharedFeature'
 * convertComponentName('landing.editor-feature') // 'LandingEditorFeature'
 */
export function convertComponentName(component: string): string {
    return component
        .split('.')
        .map(part => toPascalCase(part))
        .join('')
}

/**
 * Extract clean entity name from Strapi API interface name
 * Handles both Api* and Plugin* prefixes
 * @example
 * extractCleanName('ApiItemItem') // 'Item'
 * extractCleanName('ApiCategoryCategory') // 'Category'
 * extractCleanName('PluginUsersPermissionsUser') // 'User'
 * extractCleanName('PluginUsersPermissionsRole') // 'Role'
 */
export function extractCleanName(apiName: string): string {
    // Handle Plugin types (e.g., PluginUsersPermissionsUser -> User)
    if (apiName.startsWith('Plugin')) {
        const withoutPrefix = apiName.replace(/^PluginUsersPermissions/, '')
        return withoutPrefix || apiName
    }

    // Handle API types (e.g., ApiItemItem -> Item)
    const withoutApi = apiName.replace(/^Api/, '')

    // Find the repeated name pattern (e.g., ItemItem -> Item)
    for (let i = 1; i <= withoutApi.length / 2; i++) {
        const firstPart = withoutApi.substring(0, i)
        const secondPart = withoutApi.substring(i, i * 2)

        if (firstPart.toLowerCase() === secondPart.toLowerCase()) {
            // Return the properly cased version
            return firstPart.charAt(0).toUpperCase() + firstPart.slice(1)
        }
    }

    // Fallback: remove common suffixes or return as-is
    return withoutApi
}

/**
 * Convert clean entity name to API endpoint name
 * Follows Strapi's convention of pluralized kebab-case for collections
 * and plain kebab-case for single types
 * @example
 * toEndpointName('Item') // 'items'
 * toEndpointName('SaveGame') // 'save-games'
 * toEndpointName('Category') // 'categories'
 * toEndpointName('Homepage', true) // 'homepage'
 */
export function toEndpointName(cleanName: string, isSingle?: boolean): string {
    const kebab = toKebabCase(cleanName)
    return isSingle ? kebab : pluralize(kebab)
}

/**
 * Extract Strapi relation target to TypeScript type name
 * Handles both API and Plugin relation targets
 * @example
 * extractRelationTarget("'api::item.item'") // 'Item'
 * extractRelationTarget("'plugin::users-permissions.user'") // 'User'
 */
export function extractRelationTarget(target: string): string {
    // Remove quotes if present
    const cleaned = target.replace(/['"]/g, '')

    // Handle plugin relation (e.g., 'plugin::users-permissions.user')
    if (cleaned.startsWith('plugin::')) {
        const afterPlugin = cleaned.split('::')[1] // 'users-permissions.user'
        const modelName = afterPlugin.split('.')[1] // 'user'
        return toPascalCase(modelName)
    }

    // Handle API relation (e.g., 'api::item.item')
    if (cleaned.startsWith('api::')) {
        const afterApi = cleaned.split('::')[1] // 'item.item'
        const modelName = afterApi.split('.')[1] // 'item'
        return toPascalCase(modelName)
    }

    // Fallback - try to extract last part
    const parts = cleaned.split('.')
    return toPascalCase(parts[parts.length - 1] || cleaned)
}

/**
 * Convert Strapi component category and name to component UID
 * @example
 * toComponentUid('Landing', 'EditorFeature') // 'landing.editor-feature'
 */
export function toComponentUid(category: string, name: string): string {
    return `${toKebabCase(category)}.${toKebabCase(name)}`
}

/**
 * Extract component category from component name
 * @example
 * extractComponentCategory('landing.editor-feature') // 'landing'
 * extractComponentCategory('shared.seo') // 'shared'
 */
export function extractComponentCategory(componentUid: string): string {
    const parts = componentUid.split('.')
    return parts[0] || componentUid
}
