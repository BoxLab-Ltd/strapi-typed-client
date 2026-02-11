/**
 * Strapi Plugin Entry Point
 *
 * This module is auto-discovered by Strapi when 'strapi-typed-client' is in dependencies
 * and package.json contains strapi.kind === 'plugin'.
 *
 * No manual 'resolve' needed in config/plugins.ts — just enable the plugin:
 *
 * @example
 * ```typescript
 * export default {
 *   'strapi-typed-client': {
 *     enabled: true,
 *     config: {
 *       requireAuth: false,
 *     },
 *   },
 * }
 * ```
 */

export { default } from './server/src/index.js'
