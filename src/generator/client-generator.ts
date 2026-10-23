import { Project, SourceFile } from 'ts-morph'
import { ParsedSchema, ContentType } from '../schema-types.js'
import { AuthApiGenerator } from './auth-api-generator.js'
import type { ParsedRoute, ParsedRoutes } from '../shared/route-types.js'
import { CustomApiGenerator } from './custom-api-generator.js'
import { PluginApiGenerator } from './plugin-api-generator.js'
import { PLUGIN_REGISTRY } from './plugin-registry.js'
import { STRAPI_ERROR_REGISTRY } from './strapi-error-registry.js'
import {
    toCamelCase,
    toPascalCase,
    SCHEMA_API_PREFIX,
} from '../shared/index.js'
import type {
    ParsedEndpoint,
    ExtraControllerType,
} from '../shared/endpoint-types.js'
import type { AuthMode } from '../shared/strapi-schema-types.js'
import {
    convertEndpointsToRoutes,
    convertEndpointsToCustomTypes,
} from '../core/endpoint-converter.js'
import type { ValidationMode } from '../shared/client-header.js'

// Inlined copy of templates/stringify-query.ts (the qs-contract-tested source) embedded raw so type annotations survive `--format ts`; a drift-guard test keeps the two in sync.
export const STRINGIFY_QUERY_SOURCE = `function stringifyQuery(obj: Record<string, unknown>): string {
    const pairs: string[] = []
    for (const key of Object.keys(obj)) {
        appendEntry(obj[key], key, pairs)
    }
    return pairs.join('&')
}

function appendEntry(
    value: unknown,
    prefix: string,
    pairs: string[],
): void {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            appendEntry(value[i], \`\${prefix}[\${i}]\`, pairs)
        }
        return
    }
    if (value instanceof Date) {
        pairs.push(\`\${prefix}=\${encodeURIComponent(value.toISOString())}\`)
        return
    }
    if (typeof value === 'object') {
        for (const key of Object.keys(value as Record<string, unknown>)) {
            appendEntry(
                (value as Record<string, unknown>)[key],
                \`\${prefix}[\${key}]\`,
                pairs,
            )
        }
        return
    }
    pairs.push(\`\${prefix}=\${encodeURIComponent(String(value))}\`)
}`

const USERS_PERMISSIONS_USER = 'PluginUsersPermissionsUser'

// exactOptionalPropertyTypes rejects an explicit undefined on `prop?: T`, which both consumers and the client itself assign (#100)
function allowUndefinedOnOptionalProperties(sf: SourceFile): void {
    for (const iface of sf.getInterfaces()) {
        for (const prop of iface.getProperties()) {
            const type = prop.getTypeNode()?.getText()
            if (!prop.hasQuestionToken() || !type) continue
            if (/\bundefined\b/.test(type)) continue
            prop.setType(
                type.includes('=>')
                    ? `(${type}) | undefined`
                    : `${type} | undefined`,
            )
        }
    }
}

const NEXT_OPTIONS_PROPERTIES = [
    { name: 'revalidate', type: 'number | false' },
    { name: 'tags', type: 'string[]' },
    { name: 'cache', type: 'RequestCache' },
    { name: 'headers', type: 'Record<string, string | undefined>' },
]

// The plugin can be disabled, and then neither its content types nor its auth routes exist (#99)
function hasUsersPermissions(schema: ParsedSchema): boolean {
    return schema.contentTypes.some(ct => ct.name === USERS_PERMISSIONS_USER)
}

export class ClientGenerator {
    private authApiGenerator: AuthApiGenerator
    private customApiGenerator: CustomApiGenerator
    private pluginApiGenerator: PluginApiGenerator

    constructor() {
        this.authApiGenerator = new AuthApiGenerator()
        this.customApiGenerator = new CustomApiGenerator()
        this.pluginApiGenerator = new PluginApiGenerator()
    }

    generate(
        schema: ParsedSchema,
        endpoints?: ParsedEndpoint[],
        extraTypes?: ExtraControllerType[],
        schemaHash: string = '',
        generatorVersion: string = '',
        authMode: AuthMode = 'legacy',
        validation: ValidationMode = 'none',
    ): string {
        const project = new Project({ useInMemoryFileSystem: true })
        const sf = project.createSourceFile('client.ts')

        // Parse custom routes and custom types
        let parsedRoutes: ParsedRoutes | undefined

        if (endpoints && endpoints.length > 0) {
            parsedRoutes = convertEndpointsToRoutes(endpoints)
            // Type names the generated client actually defines, so custom
            // endpoint type strings referencing anything else (a controller-
            // local type that was never shipped) degrade to `unknown` instead
            // of emitting an undefined name.
            const knownTypeNames = new Set<string>([
                ...schema.contentTypes.map(c => c.cleanName),
                ...schema.components.map(c => c.cleanName),
                'MediaFile',
                'I18nLocale',
                ...(extraTypes?.map(t => t.typeName) ?? []),
            ])
            const customTypes = convertEndpointsToCustomTypes(
                endpoints,
                extraTypes,
                knownTypeNames,
            )
            this.customApiGenerator.setCustomTypes(customTypes)
        }

        // Header comments + baked SCHEMA_HASH / GENERATOR_VERSION. Kept at the
        // top so CLI tooling can read them by slicing the first few hundred
        // bytes of the file without parsing the rest (see readLocalSchemaHash /
        // readLocalGeneratorVersion).
        sf.addStatements([
            '/* eslint-disable */',
            '// Auto-generated Strapi API client',
            '// Do not edit manually',
            `export const SCHEMA_HASH = ${JSON.stringify(schemaHash)}`,
            `export const GENERATOR_VERSION = ${JSON.stringify(generatorVersion)}`,
            // Union-typed so `config.authMode ?? AUTH_MODE` doesn't narrow to the baked literal
            `export const AUTH_MODE: 'legacy' | 'refresh' = ${JSON.stringify(authMode)}`,
            // No type annotation: readClientHeaderConst matches `NAME = "value"`
            `export const VALIDATION = ${JSON.stringify(validation)}`,
        ])

        // Imports
        sf.addStatements(this.generateImports(schema))

        // Custom type definitions (if any)
        const customTypeDefs = this.customApiGenerator.generateTypeDefinitions()
        if (customTypeDefs) {
            sf.addStatements(customTypeDefs)
        }

        // Utility types
        this.addUtilityTypes(sf, schema)

        const usersPermissions = hasUsersPermissions(schema)

        if (usersPermissions) {
            sf.addStatements(this.authApiGenerator.generateAuthTypes(authMode))
        }

        // CollectionAPI class (static block)
        sf.addStatements(this.generateCollectionAPI())

        // SingleTypeAPI class (static block)
        sf.addStatements(this.generateSingleTypeAPI())

        if (usersPermissions) {
            // UsersPermissionsUserAPI class (flat envelope for /api/users)
            sf.addStatements(this.generateUsersPermissionsUserAPI())
        }

        // Custom API classes (for collections with custom routes)
        if (parsedRoutes) {
            sf.addStatements(
                this.generateCustomAPIClasses(schema, parsedRoutes),
            )
        }

        // AuthAPI class (with dynamic methods if auth/user routes found)
        if (usersPermissions) {
            const authRoutes = parsedRoutes?.byController.get('auth') || []
            const userRoutes = parsedRoutes?.byController.get('user') || []
            sf.addStatements(
                this.authApiGenerator.generateAuthApiClass(
                    authRoutes,
                    userRoutes,
                    authMode,
                ),
            )
        }

        // Plugin API classes (registry-driven: upload, etc.) — filter out
        // entries colliding with a user-defined standalone controller so
        // that the user's custom code wins and we don't emit duplicates.
        const activePlugins = this.computeActivePlugins(schema, parsedRoutes)
        sf.addStatements(
            this.pluginApiGenerator.generateAllPluginClasses(activePlugins),
        )

        // Main StrapiClient class
        sf.addStatements(
            this.generateStrapiClient(schema, parsedRoutes, activePlugins),
        )

        allowUndefinedOnOptionalProperties(sf)

        return sf.getFullText()
    }

    private generateImports(schema: ParsedSchema): string {
        // Import base types, GetPayload types, Input types, Filter types, and PopulateParam types
        const imports: string[] = []
        const filterImports: string[] = []

        for (const ct of schema.contentTypes) {
            imports.push(ct.cleanName)

            // Add GetPayload type if content type has populatable fields
            const hasPopulatableFields =
                ct.relations.length > 0 ||
                ct.media.length > 0 ||
                ct.components.length > 0 ||
                ct.dynamicZones.length > 0

            if (hasPopulatableFields) {
                imports.push(`${ct.cleanName}GetPayload`)
                imports.push(`${ct.cleanName}PopulateParam`)
            }

            // Add Create/Update input types for create() / update(); single types have no create()
            if (ct.kind !== 'single') imports.push(`${ct.cleanName}CreateInput`)
            imports.push(`${ct.cleanName}UpdateInput`)

            // Add Filter type for type-safe filtering
            filterImports.push(`${ct.cleanName}Filters`)
        }

        // Add MediaFile to imports
        imports.push('MediaFile')

        // Plugin API response types that are not derived from the schema
        imports.push('I18nLocale')

        // The User* imports below feed AuthAPI, which exists only with users-permissions
        const usersPermissions = hasUsersPermissions(schema)

        // Ensure User is imported for Auth types (if not already)
        if (usersPermissions && !imports.includes('User')) {
            imports.push('User')
        }

        // Ensure UserPopulateParam is imported (for AuthAPI me/updateMe overloads)
        if (usersPermissions && !imports.includes('UserPopulateParam')) {
            const userCt = schema.contentTypes.find(
                ct => ct.cleanName === 'User',
            )
            if (userCt) {
                const userHasPopulate =
                    userCt.relations.length > 0 ||
                    userCt.media.length > 0 ||
                    userCt.components.length > 0 ||
                    userCt.dynamicZones.length > 0
                if (userHasPopulate && !imports.includes('UserPopulateParam')) {
                    imports.push('UserPopulateParam')
                }
            }
        }

        // Ensure UserFilters is imported (for AuthAPI me/updateMe overloads)
        if (usersPermissions && !filterImports.includes('UserFilters')) {
            filterImports.push('UserFilters')
        }

        const filterImport = filterImports.length
            ? `\nimport type { ${filterImports.join(', ')} } from './types.js'`
            : ''
        return `import type { ${imports.join(', ')} } from './types.js'${filterImport}`
    }

    private addUtilityTypes(sf: SourceFile, schema: ParsedSchema): void {
        // StrapiResponse interface
        sf.addInterface({
            name: 'StrapiResponse',
            isExported: true,
            typeParameters: ['T'],
            properties: [
                { name: 'data', type: 'T' },
                {
                    name: 'meta',
                    type: '{ pagination?: { page: number; pageSize: number; pageCount: number; total: number } }',
                    hasQuestionToken: true,
                },
            ],
        })

        // StrapiValidationIssue + error name/details types (registry-driven)
        this.addStrapiValidationIssueInterface(sf)
        this.addStrapiErrorTypes(sf)

        // StrapiError class
        this.addStrapiErrorClass(sf)

        // StrapiConnectionError class
        this.addStrapiConnectionErrorClass(sf)

        // Type guards for StrapiError narrowing (must come AFTER the class
        // declaration so the guards can reference StrapiError).
        this.addStrapiErrorTypeGuards(sf)

        // BaseAPI class (complex — static block)
        sf.addStatements(this.generateBaseAPIClass())

        // StrapiSortOption type alias
        sf.addTypeAlias({
            name: 'StrapiSortOption',
            typeParameters: ['T'],
            type: `Exclude<keyof T & string, '__typename'> | \`\${Exclude<keyof T & string, '__typename'>}:\${"asc" | "desc"}\``,
        })

        // QueryParams interface
        sf.addInterface({
            name: 'QueryParams',
            isExported: true,
            typeParameters: [
                'TEntity = any',
                'TFilters = Record<string, any>',
                'TPopulate = any',
                `TFields extends string = Exclude<keyof TEntity & string, '__typename'>`,
            ],
            properties: [
                {
                    name: 'filters',
                    type: 'TFilters',
                    hasQuestionToken: true,
                },
                {
                    name: 'sort',
                    type: 'StrapiSortOption<TEntity> | StrapiSortOption<TEntity>[]',
                    hasQuestionToken: true,
                },
                {
                    name: 'pagination',
                    type: '{ page?: number; pageSize?: number; limit?: number; start?: number }',
                    hasQuestionToken: true,
                },
                {
                    name: 'populate',
                    type: 'TPopulate',
                    hasQuestionToken: true,
                },
                {
                    name: 'fields',
                    type: 'TFields[]',
                    hasQuestionToken: true,
                },
                {
                    name: 'locale',
                    type: 'string',
                    hasQuestionToken: true,
                },
                {
                    name: 'status',
                    type: "'draft' | 'published'",
                    hasQuestionToken: true,
                },
            ],
        })

        // UploadQueryParams interface — the upload plugin predates Strapi v5's
        // document model and uses flat `start`/`limit` for pagination instead
        // of `pagination[page]`/`pagination[pageSize]`. `filters` and `sort`
        // do follow the v5 conventions.
        sf.addInterface({
            name: 'UploadQueryParams',
            isExported: true,
            docs: [
                "Query params for the upload plugin's content-API.\n\n" +
                    'NOTE: Strapi v5 upload plugin uses flat `start`/`limit` for\n' +
                    'pagination — `pagination[page]`/`pagination[pageSize]` are\n' +
                    'silently ignored. `filters` and `sort` follow the standard\n' +
                    'Strapi v5 syntax.',
            ],
            properties: [
                {
                    name: 'filters',
                    type: 'Record<string, any>',
                    hasQuestionToken: true,
                },
                {
                    name: 'sort',
                    type: 'StrapiSortOption<MediaFile> | StrapiSortOption<MediaFile>[]',
                    hasQuestionToken: true,
                },
                {
                    name: 'fields',
                    type: "(Exclude<keyof MediaFile & string, '__typename'>)[]",
                    hasQuestionToken: true,
                },
                {
                    name: 'start',
                    type: 'number',
                    hasQuestionToken: true,
                    docs: [
                        'Offset (0-based). Upload plugin uses flat `start`, not `pagination[start]`.',
                    ],
                },
                {
                    name: 'limit',
                    type: 'number',
                    hasQuestionToken: true,
                    docs: [
                        'Page size. Upload plugin uses flat `limit`, not `pagination[pageSize]`.',
                    ],
                },
            ],
        })

        // NextOptions interface
        sf.addInterface({
            name: 'NextOptions',
            isExported: true,
            properties: NEXT_OPTIONS_PROPERTIES.map(p => ({
                ...p,
                hasQuestionToken: true,
            })),
        })

        sf.addTypeAlias({
            name: 'WriteParams',
            isExported: true,
            typeParameters: [
                { name: 'TLocalized', constraint: 'boolean' },
                { name: 'TDraftAndPublish', constraint: 'boolean' },
            ],
            docs: [
                'Query params Strapi reads on create and update. `locale` exists only on localized types, `status` only on Draft & Publish types.',
            ],
            type: "(TLocalized extends true ? { locale?: string | undefined } : { locale?: never }) & (TDraftAndPublish extends true ? { status?: 'draft' | 'published' | undefined } : { status?: never })",
        })

        sf.addTypeAlias({
            name: 'DeleteParams',
            isExported: true,
            typeParameters: [{ name: 'TLocalized', constraint: 'boolean' }],
            docs: [
                'Query params Strapi reads on delete: it drops `status` and deletes every status of the locale (`*` = all locales).',
            ],
            type: 'TLocalized extends true ? { locale?: string | undefined } : { locale?: never }',
        })

        // RequestConfig — the outgoing request as seen by onRequest
        sf.addInterface({
            name: 'RequestConfig',
            isExported: true,
            docs: [
                'The outgoing request, passed to `onRequest`. Mutate it in place, or return a partial object whose fields override the assembled request; omitted fields keep their assembled value.',
            ],
            properties: [
                { name: 'url', type: 'string' },
                { name: 'method', type: 'string', hasQuestionToken: true },
                { name: 'headers', type: 'Record<string, string>' },
                {
                    name: 'body',
                    type: 'BodyInit | null',
                    hasQuestionToken: true,
                },
                { name: 'signal', type: 'AbortSignal', hasQuestionToken: true },
            ],
        })

        // Session persistence types (refresh mode)
        sf.addInterface({
            name: 'StrapiTokenStorage',
            isExported: true,
            docs: [
                'Where the session flow keeps the refresh token between app launches (e.g. `expo-secure-store`, `react-native-keychain`). Every method may be sync or async. Only the refresh token is stored; the short-lived access token stays in memory.\n' +
                    'The token is read lazily, only when a refresh or `auth.logout()` needs it, so a biometric prompt inside `getRefreshToken` fires at that moment. A rejected or cancelled read is treated as "no token available right now": nothing is cleared and the session is not marked dead.',
            ],
            properties: [
                {
                    name: 'getRefreshToken',
                    type: '() => string | null | undefined | Promise<string | null | undefined>',
                },
                {
                    name: 'setRefreshToken',
                    type: '(token: string) => void | Promise<void>',
                    docs: [
                        'Called after a login and after every token rotation. Strapi rotates the refresh token on each refresh, so the previous one is dead once this is called.',
                    ],
                },
                {
                    name: 'clearRefreshToken',
                    type: '() => void | Promise<void>',
                    docs: [
                        'Called on `auth.clearToken()` / `auth.logout()` and when the server definitively rejects the session.',
                    ],
                },
            ],
        })

        sf.addInterface({
            name: 'StrapiSessionTokens',
            isExported: true,
            docs: ['The tokens handed to `onTokenRefreshed`.'],
            properties: [
                { name: 'accessToken', type: 'string' },
                {
                    name: 'refreshToken',
                    type: 'string',
                    hasQuestionToken: true,
                    docs: [
                        'The rotated refresh token. Absent when the backend keeps it in an httpOnly cookie.',
                    ],
                },
            ],
        })

        sf.addInterface({
            name: 'StrapiSessionExpiredInfo',
            isExported: true,
            docs: ['Passed to `onSessionExpired`.'],
            properties: [
                {
                    name: 'reason',
                    type: "'refresh-rejected' | 'invalid-response'",
                    docs: [
                        "'refresh-rejected': the server answered the refresh with a 4xx. 'invalid-response': it answered 2xx without a jwt.",
                    ],
                },
                {
                    name: 'status',
                    type: 'number',
                    hasQuestionToken: true,
                    docs: ['HTTP status of the refresh response.'],
                },
            ],
        })

        // StrapiClientConfig interface
        sf.addInterface({
            name: 'StrapiClientConfig',
            isExported: true,
            properties: [
                { name: 'baseURL', type: 'string' },
                {
                    name: 'token',
                    type: 'string',
                    hasQuestionToken: true,
                    docs: [
                        '@deprecated For user sessions prefer the built-in session flow (refresh mode); for other dynamic tokens use `onRequest` to attach the Authorization header. Still read by `request()` for now.',
                    ],
                },
                {
                    name: 'fetch',
                    type: 'typeof fetch',
                    hasQuestionToken: true,
                },
                {
                    name: 'debug',
                    type: 'boolean',
                    hasQuestionToken: true,
                },
                {
                    name: 'credentials',
                    type: 'RequestCredentials',
                    hasQuestionToken: true,
                },
                {
                    name: 'authMode',
                    type: "'legacy' | 'refresh'",
                    hasQuestionToken: true,
                    docs: [
                        "Override the users-permissions JWT mode baked in at generation time (see the exported AUTH_MODE const). 'refresh' enables the session flow: in-memory access token, `Authorization: Bearer` on every request, and an automatic single-flight refresh + retry on 401 (expired token) or an anonymous 403 (Strapi answers ForbiddenError, not 401, when a protected route is hit with no credentials — the page-reload bootstrap case). Browser-only unless `tokenStorage` is provided — in Node the session flow is otherwise inert (use API tokens server-side). Set `credentials: 'include'` alongside it when the refresh token lives in an httpOnly cookie.",
                    ],
                },
                {
                    name: 'tokenStorage',
                    type: 'StrapiTokenStorage',
                    hasQuestionToken: true,
                    docs: [
                        'Persist the refresh token across app launches (refresh mode only; needs `sessions.httpOnly: false` on the backend so the token is in the response body). Pass the storage of ONE user per client instance. Providing it also switches the session flow on outside a browser (e.g. React Native without `window`, or a Node worker that owns its storage). On start call `auth.refresh()` to restore the session from storage.',
                    ],
                },
                {
                    name: 'onTokenRefreshed',
                    type: '(tokens: StrapiSessionTokens) => void | Promise<void>',
                    hasQuestionToken: true,
                    docs: [
                        'Called after a successful refresh, once the rotated refresh token has been stored. Errors thrown here are swallowed (shown with `debug`) and never fail the request.',
                    ],
                },
                {
                    name: 'onSessionExpired',
                    type: '(info: StrapiSessionExpiredInfo) => void | Promise<void>',
                    hasQuestionToken: true,
                    docs: [
                        'Called when the server definitively rejects the session (refresh answered 4xx, or 2xx without a jwt): the stored token is already cleared, so route the user to sign-in. Not called for transient failures (5xx, network, a cancelled biometric prompt) or for an explicit `auth.logout()` / `clearToken()`. Errors thrown here are swallowed.',
                    ],
                },
                {
                    name: 'timeout',
                    type: 'number',
                    hasQuestionToken: true,
                    docs: [
                        'Request timeout in milliseconds. When set, requests that take longer will be aborted.',
                    ],
                },
                {
                    name: 'validateSchema',
                    type: 'boolean',
                    hasQuestionToken: true,
                    docs: [
                        'Enable schema validation on init (dev mode). Logs warning if types are outdated.',
                    ],
                },
                {
                    name: 'onRequest',
                    type: '(req: RequestConfig) => Partial<RequestConfig> | void | Promise<Partial<RequestConfig> | void>',
                    hasQuestionToken: true,
                    docs: [
                        'Called before each request, after headers/timeout are assembled. Mutate `req` in place, or return a partial object to override individual fields (omitted fields keep their assembled value). Use it to attach a token from any async source (replaces `setToken`). If you swap the body to/from FormData you must set the Content-Type header yourself. Setting the Authorization header here takes ownership of auth for that request: the built-in session flow will not refresh/retry it. Also runs for the session flow’s own POST /api/auth/refresh.',
                    ],
                },
                {
                    name: 'onResponse',
                    type: '(res: Response) => void | Promise<void>',
                    hasQuestionToken: true,
                    docs: [
                        'Called after a successful (2xx) response, before its body is parsed. The body stream is single-use — call `res.clone()` if you need to read it. Error responses go through `onError`, not `onResponse`.',
                    ],
                },
                {
                    name: 'onError',
                    type: '(err: StrapiError | StrapiConnectionError) => void | Promise<void>',
                    hasQuestionToken: true,
                    docs: [
                        'Called on every connection/HTTP error before it is thrown (e.g. clear a stored token or redirect on 401). The error is always re-thrown afterward.',
                    ],
                },
            ],
        })

        // Equal utility type
        sf.addTypeAlias({
            name: 'Equal',
            docs: ['Utility type for exact type equality check'],
            typeParameters: ['X', 'Y'],
            type: `(<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false`,
        })

        // GetPopulated utility type (dynamic — depends on schema)
        this.addGetPopulatedType(sf, schema)

        // SelectFields utility type
        sf.addTypeAlias({
            name: 'SelectFields',
            docs: [
                'Utility type for narrowing return type based on fields parameter',
            ],
            typeParameters: ['TFull', 'TBase', 'TFields extends string'],
            type: `[TFields] extends [never] ? TFull : Pick<TBase, Extract<TFields | 'id' | 'documentId', keyof TBase>> & Omit<TFull, keyof TBase>`,
        })
    }

    private addStrapiValidationIssueInterface(sf: SourceFile): void {
        sf.addInterface({
            name: 'StrapiValidationIssue',
            isExported: true,
            docs: [
                'A single validation issue inside a `ValidationError`.\n' +
                    'Mirrors the Yup-style errors Strapi propagates from schema validation.',
            ],
            properties: [
                {
                    name: 'path',
                    type: 'string[]',
                    docs: [
                        'Field path to the offending value (e.g. ["author", "email"]).',
                    ],
                },
                { name: 'message', type: 'string' },
                {
                    name: 'name',
                    type: 'string',
                    docs: ['The Yup validator name (e.g. "required").'],
                },
            ],
        })
    }

    private addStrapiErrorTypes(sf: SourceFile): void {
        const names = STRAPI_ERROR_REGISTRY.map(c => `'${c.errorName}'`)
        const namedUnion = names.join(' | ')

        sf.addTypeAlias({
            name: 'StrapiErrorName',
            isExported: true,
            docs: [
                'Known Strapi v5 error names. Other strings are still accepted at\n' +
                    'runtime via the `(string & {})` fallback so plugin or future-version\n' +
                    'errors are not lost.',
            ],
            type: `${namedUnion} | (string & {})`,
        })

        const mapEntries = STRAPI_ERROR_REGISTRY.map(
            c => `  ${c.errorName}: ${c.detailsType}`,
        ).join('\n')

        sf.addTypeAlias({
            name: 'StrapiErrorDetailsMap',
            isExported: true,
            docs: [
                'Maps each known `StrapiErrorName` to the shape of its `details`\n' +
                    'payload. Used by `isStrapiErrorOf` to narrow `details` after the\n' +
                    'discriminator check. Wrapped in `Partial` because Strapi may\n' +
                    'omit `details` even when the error name is known.',
            ],
            type: `Partial<{\n${mapEntries}\n}>`,
        })

        sf.addInterface({
            name: 'UnknownStrapiErrorDetails',
            isExported: true,
            docs: [
                'Fallback shape when `errorName` is not in `StrapiErrorDetailsMap`\n' +
                    '(e.g. 3rd-party plugin errors or Strapi versions newer than this client).',
            ],
            properties: [
                { name: 'errorName', type: 'string' },
                {
                    name: 'details',
                    type: 'Record<string, unknown>',
                    hasQuestionToken: true,
                },
            ],
        })
    }

    private addStrapiErrorClass(sf: SourceFile): void {
        sf.addClass({
            name: 'StrapiError',
            isExported: true,
            docs: [
                'Error thrown for non-2xx responses from Strapi.\n\n' +
                    'Use `isStrapiErrorOf(err, "ValidationError")` (or any other\n' +
                    'name) to narrow `details` to its typed shape.\n\n' +
                    '@example\n' +
                    '```ts\n' +
                    "try { await strapi.articles.create({ title: '' }) }\n" +
                    'catch (e) {\n' +
                    "  if (isStrapiErrorOf(e, 'ValidationError')) {\n" +
                    '    for (const issue of e.details?.errors ?? []) {\n' +
                    "      console.log(issue.path.join('.'), issue.message)\n" +
                    '    }\n' +
                    '  }\n' +
                    '}\n' +
                    '```',
            ],
            extends: 'Error',
            properties: [
                {
                    name: 'userMessage',
                    type: 'string',
                    docs: ['Clean user-friendly message from Strapi backend'],
                },
                {
                    name: 'status',
                    type: 'number',
                    docs: ['HTTP status code'],
                },
                {
                    name: 'statusText',
                    type: 'string',
                    docs: ['HTTP status text'],
                },
                {
                    name: 'errorName',
                    type: 'StrapiErrorName',
                    docs: [
                        'Strapi-side error name (e.g. "ValidationError", "PolicyError").\n' +
                            'Use as discriminator with `isStrapiErrorOf`. `Error.name` itself\n' +
                            'remains "StrapiError" so Sentry/sourcemap contracts are unchanged.',
                    ],
                },
                {
                    name: 'details',
                    type: 'unknown',
                    hasQuestionToken: true,
                    docs: [
                        'Additional error details from Strapi. Typed as `unknown` —\n' +
                            'narrow via `isStrapiErrorOf` for typed access.',
                    ],
                },
            ],
            ctors: [
                {
                    parameters: [
                        { name: 'message', type: 'string' },
                        { name: 'userMessage', type: 'string' },
                        { name: 'status', type: 'number' },
                        { name: 'statusText', type: 'string' },
                        {
                            name: 'details',
                            type: 'unknown',
                            hasQuestionToken: true,
                        },
                        {
                            name: 'errorName',
                            type: 'StrapiErrorName',
                            initializer: "'UnknownError'",
                        },
                    ],
                    statements: [
                        'super(message)',
                        'this.name = "StrapiError"',
                        'this.userMessage = userMessage',
                        'this.status = status',
                        'this.statusText = statusText',
                        'this.errorName = errorName',
                        'this.details = details',
                    ],
                },
            ],
        })
    }

    private addStrapiErrorTypeGuards(sf: SourceFile): void {
        sf.addStatements(`
/**
 * Type guard: is the value a StrapiError instance?
 */
export function isStrapiError(err: unknown): err is StrapiError {
    return err instanceof StrapiError
}

/**
 * Type guard that narrows both \`errorName\` and \`details\` for a specific
 * Strapi error type.
 *
 * @example
 * if (isStrapiErrorOf(err, 'ValidationError')) {
 *   err.details?.errors?.[0]?.path // string[] | undefined
 * }
 */
export function isStrapiErrorOf<N extends keyof StrapiErrorDetailsMap>(
    err: unknown,
    name: N,
): err is StrapiError & { errorName: N; details: StrapiErrorDetailsMap[N] } {
    return isStrapiError(err) && err.errorName === name
}
`)
    }

    private addStrapiConnectionErrorClass(sf: SourceFile): void {
        sf.addClass({
            name: 'StrapiConnectionError',
            isExported: true,
            docs: [
                'Error thrown when the client cannot connect to Strapi (network failures, DNS, timeouts)',
            ],
            extends: 'Error',
            properties: [
                {
                    name: 'url',
                    type: 'string',
                    docs: ['The URL that was being requested'],
                },
            ],
            ctors: [
                {
                    parameters: [
                        { name: 'message', type: 'string' },
                        { name: 'url', type: 'string' },
                        {
                            name: 'cause',
                            type: 'Error',
                            hasQuestionToken: true,
                        },
                    ],
                    statements: [
                        'super(message)',
                        'this.name = "StrapiConnectionError"',
                        'this.url = url',
                        'this.cause = cause',
                    ],
                },
            ],
        })
        // Error.cause exists only with lib ES2022, so a class member would need `override` there and reject it elsewhere (#100)
        sf.addInterface({
            name: 'StrapiConnectionError',
            isExported: true,
            properties: [
                {
                    name: 'cause',
                    type: 'Error',
                    hasQuestionToken: true,
                    docs: [
                        'The original error that caused the connection failure',
                    ],
                },
            ],
        })
    }

    private generateBaseAPIClass(): string {
        return `// Session state for the users-permissions refresh flow. Keyed by the
// config object — every API class of one StrapiClient shares the same config
// reference, so the session (and its single-flight refresh) is client-wide
// without widening the public config shape. The leading underscore keeps the
// name from colliding with a user content type imported from './types.js'.
interface _AuthSessionState {
  accessToken?: string
  refreshToken?: string
  refreshPromise?: Promise<boolean>
  // Set when the server definitively rejected a refresh (or after an
  // explicit clearToken/logout): the automatic refresh stays quiet until the
  // next login or explicit auth.refresh(), instead of re-hitting the backend
  // on every 401. Transient failures (5xx, network) never set this.
  dead?: boolean
  // Bumped by login (_captureSession) and clearToken/logout. An in-flight
  // refresh snapshots it and discards its own outcome when it changed:
  // whoever bumped the epoch is authoritative — a late refresh success must
  // not resurrect a logged-out session, and a late 4xx must not wipe a
  // fresh login.
  epoch: number
  // Tail of the serialized tokenStorage operations (writes, clears and the
  // lazy read all queue here, so a slow write can never overtake a clear and
  // resurrect a signed-out session). It never rejects.
  storageQueue?: Promise<void>
}

const authSessionStore = new WeakMap<StrapiClientConfig, _AuthSessionState>()

function getAuthSession(config: StrapiClientConfig): _AuthSessionState {
  let session = authSessionStore.get(config)
  if (!session) {
    session = { epoch: 0 }
    authSessionStore.set(config, session)
  }
  return session
}

// All header keys spelling 'authorization', in any casing. Header objects are
// case-sensitive plain records here, but HTTP semantics (and fetch's wire
// merging) are case-insensitive — auth ownership decisions must be too.
function authHeaderValues(headers: Record<string, string>): string[] {
  return Object.keys(headers)
    .filter(k => k.toLowerCase() === 'authorization')
    .map(k => headers[k])
    .filter((value): value is string => value !== undefined)
}

// RequestInit that also takes an explicit undefined, which exactOptionalPropertyTypes otherwise rejects
type RequestOptions = { [K in keyof RequestInit]?: RequestInit[K] | undefined } & { next?: unknown }

// Older releases took nextOptions as the second argument of create/update/delete; its keys never overlap the write params
const NEXT_OPTION_KEYS: readonly string[] = ${JSON.stringify(NEXT_OPTIONS_PROPERTIES.map(p => p.name))}

// Base API class with shared logic
class BaseAPI {
  constructor(protected config: StrapiClientConfig) {}

  protected splitWriteArgs(params: any, nextOptions: any): [any, any] {
    const keys = params !== null && typeof params === 'object' ? Object.keys(params) : []
    const legacy =
      nextOptions === undefined &&
      keys.length > 0 &&
      keys.every(k => NEXT_OPTION_KEYS.includes(k))
    return legacy ? [undefined, params] : [params, nextOptions]
  }

  protected _authMode(): 'legacy' | 'refresh' {
    return this.config.authMode ?? AUTH_MODE
  }

  /**
   * The automatic session flow (token capture, Bearer injection, refresh on
   * 401) is active only in refresh mode AND in a browser-like runtime (or
   * when the caller passes a \`tokenStorage\`). In plain Node the whole
   * mechanism is otherwise inert: there is no cookie jar for a cookie-based
   * refresh, and silently storing tokens on a client instance that may be
   * shared across requests (e.g. a Next.js module singleton) would leak one
   * user's session into another user's requests. Server-side code should use
   * API tokens (\`token\`) or explicit \`setToken\`. A \`tokenStorage\` is an
   * explicit opt-in: the caller owns where the session lives and promises
   * the client instance belongs to one user (an app, not a shared server).
   */
  protected _sessionEnabled(): boolean {
    return (
      this._authMode() === 'refresh' &&
      (typeof (globalThis as { window?: unknown }).window !== 'undefined' ||
        this.config.tokenStorage !== undefined)
    )
  }

  // Run a user hook; a throwing hook must never break a request or a refresh.
  protected async _notify<A>(
    hook: ((arg: A) => void | Promise<void>) | undefined,
    arg: A
  ): Promise<void> {
    if (!hook) return
    try {
      await hook(arg)
    } catch (err) {
      if (this.config.debug) console.warn('[Strapi Auth] session hook threw', err)
    }
  }

  // Queue a tokenStorage operation behind the earlier ones. Never rejects:
  // a failing store must not fail a login, a refresh or a sign-out.
  private _queueStorage(session: _AuthSessionState, task: () => void | Promise<void>): Promise<void> {
    const run = (session.storageQueue ?? Promise.resolve())
      .then(task)
      .catch(err => {
        if (this.config.debug) console.warn('[Strapi Auth] tokenStorage failed', err)
      })
    session.storageQueue = run
    return run
  }

  // Persist a refresh token unless the session changed hands (login or
  // sign-out bumped the epoch) before the queued write got its turn.
  private _persistRefreshToken(session: _AuthSessionState, token: string, epoch: number): Promise<void> {
    const storage = this.config.tokenStorage
    if (!storage) return Promise.resolve()
    return this._queueStorage(session, async () => {
      if (session.epoch !== epoch) return
      await storage.setRefreshToken(token)
    })
  }

  protected _clearStoredRefreshToken(session: _AuthSessionState): Promise<void> {
    const storage = this.config.tokenStorage
    if (!storage) return Promise.resolve()
    return this._queueStorage(session, () => storage.clearRefreshToken())
  }

  /**
   * Make the refresh token available in memory, reading \`tokenStorage\` the
   * first time it is needed (this is where a biometric prompt fires). The
   * token is then cached for the life of the session. A failed or cancelled
   * read yields undefined and changes no state.
   */
  protected async _loadRefreshToken(session: _AuthSessionState): Promise<string | undefined> {
    if (session.refreshToken) return session.refreshToken
    const storage = this.config.tokenStorage
    if (!storage || !this._sessionEnabled()) return undefined
    const epoch = session.epoch
    try {
      // Behind any queued write, so the read can't see a token about to be replaced
      await session.storageQueue
      const token = await storage.getRefreshToken()
      if (session.epoch !== epoch) return session.refreshToken
      if (token) session.refreshToken = token
      return token || undefined
    } catch (err) {
      if (this.config.debug) console.warn('[Strapi Auth] tokenStorage read failed', err)
      return undefined
    }
  }

  /**
   * Store the session tokens from an auth response ({ jwt, refreshToken? }).
   * No-op in legacy mode and in a runtime without a session (see
   * _sessionEnabled). Resolves once the refresh token is persisted.
   */
  protected async _captureSession<T>(res: T): Promise<T> {
    if (!this._sessionEnabled()) return res
    const auth = res as { jwt?: unknown; refreshToken?: unknown } | null | undefined
    if (auth && typeof auth.jwt === 'string') {
      const session = getAuthSession(this.config)
      session.accessToken = auth.jwt
      if (typeof auth.refreshToken === 'string') {
        session.refreshToken = auth.refreshToken
      }
      // A fresh login revives the session — lift the dead-session latch and
      // invalidate any refresh still in flight (its outcome is stale now).
      session.dead = undefined
      session.epoch++
      if (typeof auth.refreshToken === 'string') {
        await this._persistRefreshToken(session, auth.refreshToken, session.epoch)
      }
    }
    return res
  }

  /**
   * Rotate the refresh token via POST /api/auth/refresh. Single-flight: all
   * concurrent 401s share one in-flight refresh (token rotation is idempotent
   * on the backend, this just avoids redundant requests).
   */
  protected _refreshSession(): Promise<boolean> {
    const session = getAuthSession(this.config)
    if (!session.refreshPromise) {
      session.refreshPromise = this._performTokenRefresh(session).finally(() => {
        session.refreshPromise = undefined
      })
    }
    return session.refreshPromise
  }

  private async _performTokenRefresh(session: _AuthSessionState): Promise<boolean> {
    const fetchFn = this.config.fetch || globalThis.fetch
    // Snapshot the epoch: if login()/clearToken() mutate the session while
    // this request is on the wire, their state is authoritative and this
    // refresh's outcome is discarded (see _AuthSessionState.epoch).
    const epoch = session.epoch
    // Outside the browser nothing is persisted — an explicit auth.refresh()
    // still reports whether a live session exists, but a shared server-side
    // client must never store one caller's rotated token for the next caller.
    const persist = this._sessionEnabled()
    try {
      // Cold start: the refresh token lives in tokenStorage, not in memory yet.
      // Single-flight (we are inside the shared refresh promise), so concurrent
      // 401s trigger one biometric prompt, not many. No token means there is no
      // session to resume — answer false without a pointless round trip.
      if (persist && this.config.tokenStorage && !session.refreshToken) {
        await this._loadRefreshToken(session)
        if (session.epoch !== epoch) return !!session.accessToken
        if (!session.refreshToken) return false
      }
      // Raw fetch, not this.request() — a 401 here must not recurse into
      // another refresh, and no Authorization is attached (Strapi rejects
      // requests carrying an invalid Bearer even on public routes). The
      // token travels in the httpOnly cookie (credentials) or, for
      // non-httpOnly setups, in the body.
      let url = \`\${this.config.baseURL}/api/auth/refresh\`
      const init: RequestOptions = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(session.refreshToken && { body: JSON.stringify({ refreshToken: session.refreshToken }) }),
        ...(this.config.credentials && { credentials: this.config.credentials }),
      }

      // The refresh request honours onRequest like any other request, so
      // infrastructure headers (tenant ids, proxy keys) reach it too.
      if (this.config.onRequest) {
        const reqConfig: RequestConfig = {
          url,
          method: 'POST',
          headers: init.headers as Record<string, string>,
          body: init.body ?? undefined,
        }
        const result = await this.config.onRequest(reqConfig)
        const eff = result ? { ...reqConfig, ...result } : reqConfig
        url = eff.url
        init.method = eff.method
        init.headers = eff.headers
        init.body = eff.body
        if (eff.signal) init.signal = eff.signal
      }

      const response = await fetchFn(url, init as RequestInit)
      if (session.epoch !== epoch) return !!session.accessToken
      if (!response.ok) {
        // 4xx = the session is gone for good (401 dead, 403 rejected,
        // 404 legacy backend) — drop it and latch. 5xx is transient:
        // keep everything and let the original 401 propagate.
        if (response.status < 500 && persist) {
          session.accessToken = undefined
          session.refreshToken = undefined
          session.dead = true
          await this._clearStoredRefreshToken(session)
          await this._notify(this.config.onSessionExpired, {
            reason: 'refresh-rejected',
            status: response.status,
          })
        }
        return false
      }
      const data = (await response.json().catch(() => null)) as {
        jwt?: string
        refreshToken?: string
      } | null
      if (session.epoch !== epoch) return !!session.accessToken
      if (!data?.jwt) {
        // 2xx without a jwt — broken contract, retrying won't help.
        if (persist) {
          session.accessToken = undefined
          session.dead = true
          await this._clearStoredRefreshToken(session)
          await this._notify(this.config.onSessionExpired, {
            reason: 'invalid-response',
            status: response.status,
          })
        }
        return false
      }
      if (persist) {
        // Memory first, synchronously: a request issued while the storage
        // write is pending already sees the new access token.
        session.accessToken = data.jwt
        if (data.refreshToken) {
          session.refreshToken = data.refreshToken
        }
        session.dead = undefined
        // The old refresh token is dead server-side now. Wait for the
        // rotated one to be stored before reporting success, so an app kill
        // right after cannot strand the user with a token that no longer works.
        if (data.refreshToken) {
          await this._persistRefreshToken(session, data.refreshToken, epoch)
        }
        if (session.epoch !== epoch) return !!session.accessToken
        await this._notify(this.config.onTokenRefreshed, {
          accessToken: data.jwt,
          ...(data.refreshToken && { refreshToken: data.refreshToken }),
        })
      }
      return true
    } catch {
      // Network failure — keep the tokens (the session may still be alive)
      // and let the original 401 propagate.
      return false
    }
  }

  private getErrorHint(status: number): string {
    switch (status) {
      case 401: return ' Hint: check that your API token is valid and passed to StrapiClient config.'
      case 403: return ' Hint: your token may lack permissions for this endpoint. Check Strapi roles & permissions.'
      case 404: return ' Hint: the document does not exist, or this endpoint does not (verify the content type is created in Strapi and the API is enabled).'
      case 500: return ' Hint: internal Strapi error. Check Strapi server logs for details.'
      default: return ''
    }
  }

  protected async request<R>(
    url: string,
    options: RequestOptions = {},
    nextOptions?: NextOptions,
    errorPrefix = 'Strapi API',
    _isRetry = false
  ): Promise<R> {
    const fetchFn = this.config.fetch || globalThis.fetch
    // Kept for the post-refresh retry — \`url\` may be mutated by onRequest.
    const originalUrl = url

    const headers: Record<string, string> = {
      ...options.headers as Record<string, string>,
    }

    // Only add Content-Type for JSON, let browser set it for FormData
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }

    // With the session flow active the in-memory token wins over the static
    // one. Skip both when the caller's own options already carry an
    // authorization header (any casing) — that request is not ours to auth.
    const sessionToken = this._sessionEnabled()
      ? getAuthSession(this.config).accessToken
      : undefined
    if (authHeaderValues(headers).length === 0) {
      if (sessionToken) {
        headers['Authorization'] = \`Bearer \${sessionToken}\`
      } else if (this.config.token) {
        headers['Authorization'] = \`Bearer \${this.config.token}\`
      }
    }

    // Merge custom headers from nextOptions. An authorization key replaces
    // any existing spelling — plain records are case-sensitive but the wire
    // is not, and two surviving spellings would be merged by fetch into one
    // malformed comma-joined header.
    if (nextOptions?.headers) {
      for (const [key, value] of Object.entries(nextOptions.headers)) {
        if (value !== undefined) {
          if (key.toLowerCase() === 'authorization') {
            for (const existing of Object.keys(headers)) {
              if (existing.toLowerCase() === 'authorization') delete headers[existing]
            }
          }
          headers[key] = value
        }
      }
    }

    const fetchOptions: RequestOptions = {
      ...options,
      headers,
      ...(this.config.credentials && { credentials: this.config.credentials }),
    }

    // Add Next.js cache options if provided
    if (nextOptions) {
      if (nextOptions.revalidate !== undefined || nextOptions.tags) {
        fetchOptions.next = {
          ...(nextOptions.revalidate !== undefined && { revalidate: nextOptions.revalidate }),
          ...(nextOptions.tags && { tags: nextOptions.tags }),
        }
      }
      if (nextOptions.cache) {
        fetchOptions.cache = nextOptions.cache
      }
    }

    // Timeout support via AbortController
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (this.config.timeout) {
      const controller = new AbortController()
      fetchOptions.signal = controller.signal
      timeoutId = setTimeout(() => controller.abort(), this.config.timeout)
    }

    // onRequest interceptor — mutate/replace the outgoing request before fetch
    if (this.config.onRequest) {
      const reqConfig: RequestConfig = {
        url,
        method: fetchOptions.method ?? 'GET',
        headers: fetchOptions.headers as Record<string, string>,
        body: fetchOptions.body ?? undefined,
        signal: fetchOptions.signal as AbortSignal | undefined,
      }
      const result = await this.config.onRequest(reqConfig)
      // Merge over the assembled config so a partial return can't drop method/body.
      const eff = result ? { ...reqConfig, ...result } : reqConfig
      url = eff.url
      fetchOptions.method = eff.method
      fetchOptions.headers = eff.headers
      fetchOptions.body = eff.body
      // Keep the timeout signal unless the hook set its own.
      if (eff.signal) fetchOptions.signal = eff.signal

      // If the hook added its own authorization under a different casing,
      // drop our session entry so fetch doesn't merge both spellings into
      // one malformed comma-joined wire header. The hook's credential wins.
      const hookHeaders = fetchOptions.headers as Record<string, string>
      if (sessionToken && authHeaderValues(hookHeaders).length > 1) {
        for (const key of Object.keys(hookHeaders)) {
          if (
            key.toLowerCase() === 'authorization' &&
            hookHeaders[key] === \`Bearer \${sessionToken}\`
          ) {
            delete hookHeaders[key]
          }
        }
      }
    }

    if (this.config.debug) {
      console.log(\`[\${errorPrefix}] \${fetchOptions.method || 'GET'} \${url}\`)
    }

    let response: Response
    try {
      response = await fetchFn(url, fetchOptions as RequestInit)
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId)

      const baseURL = this.config.baseURL
      const msg = error?.message || String(error)

      let connErr: StrapiConnectionError
      if (error?.name === 'AbortError') {
        // Timeout (AbortController abort)
        connErr = new StrapiConnectionError(
          \`Request timed out after \${this.config.timeout}ms. URL: \${url}\`,
          url,
          error
        )
      } else if (msg.includes('ECONNREFUSED')) {
        // Connection refused
        connErr = new StrapiConnectionError(
          \`Could not connect to Strapi at \${baseURL}. Is the server running?\`,
          url,
          error
        )
      } else if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
        // DNS resolution failure
        connErr = new StrapiConnectionError(
          \`Could not resolve host. Check your baseURL: \${baseURL}\`,
          url,
          error
        )
      } else {
        // Generic network error
        connErr = new StrapiConnectionError(
          \`Network error: \${msg}. Check your baseURL: \${baseURL}\`,
          url,
          error
        )
      }

      if (this.config.onError) await this.config.onError(connErr)
      throw connErr
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }

    if (!response.ok) {
      // Session flow: refresh once (single-flight across concurrent
      // requests) and retry the original request one time. Only for
      // requests the session flow itself authorized: sent with OUR session
      // Bearer, or anonymously. If someone else set Authorization — a
      // static config.token, an onRequest hook, per-request headers — the
      // flow steps aside and the error propagates untouched. onError is
      // NOT invoked for an error that a successful refresh absorbs.
      //
      // Two trigger statuses, matching Strapi's semantics: 401 means
      // "credentials were provided and are invalid" (expired session
      // Bearer); 403 on a FULLY anonymous request is the page-load
      // bootstrap case — an anonymous caller authenticates as the public
      // role and a protected route answers ForbiddenError, never 401. A
      // 403 under any Bearer is an honest permission error and passes.
      const sentAuthValues = authHeaderValues(
        fetchOptions.headers as Record<string, string>
      )
      const sessionOwnsRequest =
        sentAuthValues.length === 0 ||
        (sentAuthValues.length === 1 &&
          sessionToken !== undefined &&
          sentAuthValues[0] === \`Bearer \${sessionToken}\`)
      const refreshTrigger =
        response.status === 401
          ? sessionOwnsRequest
          : response.status === 403 && sentAuthValues.length === 0
      if (
        refreshTrigger &&
        !_isRetry &&
        this._sessionEnabled() &&
        // dead-session latch: don't re-hit the backend on every 401/403 once
        // a refresh was definitively rejected; login or auth.refresh() lifts it
        !getAuthSession(this.config).dead
      ) {
        const refreshed = await this._refreshSession()
        if (refreshed) {
          return this.request<R>(originalUrl, options, nextOptions, errorPrefix, true)
        }
      }

      // Detect HTML response (wrong server / reverse proxy error page)
      const contentType = response.headers.get('content-type') || ''
      let httpErr: StrapiError
      if (contentType.includes('text/html')) {
        httpErr = new StrapiError(
          \`Strapi returned HTML instead of JSON. Your baseURL may point to the wrong server. URL: \${url}\`,
          'Unexpected HTML response from server',
          response.status,
          response.statusText,
          undefined,
          'UnknownError'
        )
      } else {
        const errorData = await response.json().catch(() => ({}))
        const userMessage = errorData.error?.message || response.statusText
        const hint = this.getErrorHint(response.status)
        const technicalMessage = \`\${errorPrefix} error: \${response.status} \${response.statusText}\${errorData.error?.message ? ' - ' + errorData.error.message : ''}\${hint}\`
        httpErr = new StrapiError(
          technicalMessage,
          userMessage,
          response.status,
          response.statusText,
          errorData.error?.details,
          errorData.error?.name ?? 'UnknownError'
        )
      }

      if (this.config.onError) await this.config.onError(httpErr)
      throw httpErr
    }

    // onResponse interceptor — observe a successful response before parsing.
    // The body is single-use; a hook that reads it must use response.clone().
    if (this.config.onResponse) {
      await this.config.onResponse(response)
    }

    // Handle 204 No Content (e.g., from DELETE operations)
    if (response.status === 204) {
      return null as R
    }

    return response.json()
  }

  protected buildQueryString(params?: object): string {
    if (!params) return ''
    const query = stringifyQuery(params as Record<string, unknown>)
    return query ? \`?\${query}\` : ''
  }
}

${STRINGIFY_QUERY_SOURCE}`
    }

    private addGetPopulatedType(sf: SourceFile, schema: ParsedSchema): void {
        const typesWithPayload = schema.contentTypes.filter(
            ct =>
                ct.relations.length > 0 ||
                ct.media.length > 0 ||
                ct.components.length > 0 ||
                ct.dynamicZones.length > 0,
        )

        const conditionalBranches = typesWithPayload
            .map(
                ct =>
                    `Equal<TBase, ${ct.cleanName}> extends true ? ${ct.cleanName}GetPayload<{ populate: TPopulate }> :`,
            )
            .join('\n  ')

        sf.addTypeAlias({
            name: 'GetPopulated',
            docs: [
                'Utility type to automatically infer populated type based on base type\nUses exact equality instead of extends to avoid structural typing issues',
            ],
            typeParameters: ['TBase', 'TPopulate'],
            type: conditionalBranches
                ? `${conditionalBranches}\n  TBase`
                : 'TBase',
        })
    }

    private generateCollectionAPI(): string {
        return `// Collection API wrapper with type-safe populate support
class CollectionAPI<
  TBase,
  TCreateInput = Partial<TBase>,
  TUpdateInput = Partial<TBase>,
  TFilters = Record<string, any>,
  TPopulateKeys extends Record<string, any> = Record<string, any>,
  TLocalized extends boolean = boolean,
  TDraftAndPublish extends boolean = boolean
> extends BaseAPI {
  constructor(
    protected endpoint: string,
    config: StrapiClientConfig
  ) {
    super(config)
  }

  // Envelope hooks — standard content types use Strapi's { data } wrapper.
  // Subclasses (e.g. the users-permissions endpoint) override these to send
  // and receive a flat payload instead.
  protected wrapBody(data: any): any {
    return { data }
  }

  protected unwrap(response: any): any {
    return response?.data
  }

  // Overload: with populate object → populated return type
  find<const TPopulate extends TPopulateKeys, const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params: { populate: TPopulate } & QueryParams<TBase, TFilters, TPopulate, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields>[]>
  // Overload: with populate '*' or true → all fields populated
  find<const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params: { populate: '*' | true } & QueryParams<TBase, TFilters, '*' | true, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<TBase, '*'>, TBase, TFields>[]>
  // Overload: with populate array → populated return type
  find<const TPopulate extends readonly (keyof TPopulateKeys & string)[], const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params: { populate: TPopulate } & QueryParams<TBase, TFilters, TPopulate, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields>[]>
  // Overload: general case → base return type
  find<const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params?: QueryParams<TBase, TFilters, TPopulateKeys | (keyof TPopulateKeys & string)[] | '*' | boolean, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<TBase, TBase, TFields>[]>

  async find(params?: any, nextOptions?: any): Promise<any> {
    const query = this.buildQueryString(params)
    const url = \`\${this.config.baseURL}/api/\${this.endpoint}\${query}\`
    const response = await this.request<StrapiResponse<any[]>>(url, {}, nextOptions)
    return this.unwrap(response)
  }

  // Overload: with populate object → populated return type
  findWithMeta<const TPopulate extends TPopulateKeys, const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params: { populate: TPopulate } & QueryParams<TBase, TFilters, TPopulate, TFields>,
    nextOptions?: NextOptions
  ): Promise<StrapiResponse<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields>[]>>
  // Overload: with populate '*' or true → all fields populated
  findWithMeta<const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params: { populate: '*' | true } & QueryParams<TBase, TFilters, '*' | true, TFields>,
    nextOptions?: NextOptions
  ): Promise<StrapiResponse<SelectFields<GetPopulated<TBase, '*'>, TBase, TFields>[]>>
  // Overload: with populate array → populated return type
  findWithMeta<const TPopulate extends readonly (keyof TPopulateKeys & string)[], const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params: { populate: TPopulate } & QueryParams<TBase, TFilters, TPopulate, TFields>,
    nextOptions?: NextOptions
  ): Promise<StrapiResponse<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields>[]>>
  // Overload: general case → base return type
  findWithMeta<const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params?: QueryParams<TBase, TFilters, TPopulateKeys | (keyof TPopulateKeys & string)[] | '*' | boolean, TFields>,
    nextOptions?: NextOptions
  ): Promise<StrapiResponse<SelectFields<TBase, TBase, TFields>[]>>

  async findWithMeta(params?: any, nextOptions?: any): Promise<any> {
    const query = this.buildQueryString(params)
    const url = \`\${this.config.baseURL}/api/\${this.endpoint}\${query}\`
    return this.request<StrapiResponse<any[]>>(url, {}, nextOptions)
  }

  // Overload: with populate object → populated return type
  findOne<const TPopulate extends TPopulateKeys, const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    documentId: string,
    params: { populate: TPopulate } & QueryParams<TBase, TFilters, TPopulate, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields>>
  // Overload: with populate '*' or true → all fields populated
  findOne<const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    documentId: string,
    params: { populate: '*' | true } & QueryParams<TBase, TFilters, '*' | true, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<TBase, '*'>, TBase, TFields>>
  // Overload: with populate array → populated return type
  findOne<const TPopulate extends readonly (keyof TPopulateKeys & string)[], const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    documentId: string,
    params: { populate: TPopulate } & QueryParams<TBase, TFilters, TPopulate, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields>>
  // Overload: general case → base return type
  findOne<const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    documentId: string,
    params?: QueryParams<TBase, TFilters, TPopulateKeys | (keyof TPopulateKeys & string)[] | '*' | boolean, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<TBase, TBase, TFields>>

  async findOne(documentId: string, params?: any, nextOptions?: any): Promise<any> {
    const query = this.buildQueryString(params)
    const url = \`\${this.config.baseURL}/api/\${this.endpoint}/\${documentId}\${query}\`
    const response = await this.request<StrapiResponse<any>>(url, {}, nextOptions)
    return this.unwrap(response)
  }

  /** @deprecated Pass Next.js options as the third argument: \`create(data, {}, nextOptions)\`. */
  create(data: TCreateInput | FormData, nextOptions: NextOptions): Promise<TBase>
  create(data: TCreateInput | FormData, params?: WriteParams<TLocalized, TDraftAndPublish>, nextOptions?: NextOptions): Promise<TBase>

  async create(data: TCreateInput | FormData, params?: any, nextOptions?: NextOptions): Promise<TBase> {
    ;[params, nextOptions] = this.splitWriteArgs(params, nextOptions)
    // FormData is sent as-is; everything else goes through the envelope hook
    const body = data instanceof FormData
      ? data
      : JSON.stringify(this.wrapBody(data))

    const url = \`\${this.config.baseURL}/api/\${this.endpoint}\${this.buildQueryString(params)}\`
    const response = await this.request<StrapiResponse<TBase>>(
      url,
      {
        method: 'POST',
        body,
      },
      nextOptions
    )
    return this.unwrap(response)
  }

  /** @deprecated Pass Next.js options as the fourth argument: \`update(documentId, data, {}, nextOptions)\`. */
  update(documentId: string, data: TUpdateInput | FormData, nextOptions: NextOptions): Promise<TBase>
  update(documentId: string, data: TUpdateInput | FormData, params?: WriteParams<TLocalized, TDraftAndPublish>, nextOptions?: NextOptions): Promise<TBase>

  async update(documentId: string, data: TUpdateInput | FormData, params?: any, nextOptions?: NextOptions): Promise<TBase> {
    ;[params, nextOptions] = this.splitWriteArgs(params, nextOptions)
    // FormData is sent as-is; everything else goes through the envelope hook
    const body = data instanceof FormData
      ? data
      : JSON.stringify(this.wrapBody(data))

    const url = \`\${this.config.baseURL}/api/\${this.endpoint}/\${documentId}\${this.buildQueryString(params)}\`
    const response = await this.request<StrapiResponse<TBase>>(
      url,
      {
        method: 'PUT',
        body,
      },
      nextOptions
    )
    return this.unwrap(response)
  }

  /** @deprecated Pass Next.js options as the third argument: \`delete(documentId, {}, nextOptions)\`. */
  delete(documentId: string, nextOptions: NextOptions): Promise<TBase | null>
  delete(documentId: string, params?: DeleteParams<TLocalized>, nextOptions?: NextOptions): Promise<TBase | null>

  async delete(documentId: string, params?: any, nextOptions?: NextOptions): Promise<TBase | null> {
    ;[params, nextOptions] = this.splitWriteArgs(params, nextOptions)
    const url = \`\${this.config.baseURL}/api/\${this.endpoint}/\${documentId}\${this.buildQueryString(params)}\`
    const response = await this.request<StrapiResponse<TBase> | null>(
      url,
      {
        method: 'DELETE',
      },
      nextOptions
    )
    return this.unwrap(response) ?? null
  }
}`
    }

    private generateSingleTypeAPI(): string {
        return `// Single Type API wrapper with type-safe populate support
class SingleTypeAPI<
  TBase,
  TUpdateInput = Partial<TBase>,
  TFilters = Record<string, any>,
  TPopulateKeys extends Record<string, any> = Record<string, any>,
  TLocalized extends boolean = boolean,
  TDraftAndPublish extends boolean = boolean
> extends BaseAPI {
  constructor(
    protected endpoint: string,
    config: StrapiClientConfig
  ) {
    super(config)
  }

  // Overload: with populate object → populated return type
  find<const TPopulate extends TPopulateKeys, const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params: { populate: TPopulate } & QueryParams<TBase, TFilters, TPopulate, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields>>
  // Overload: with populate '*' or true → all fields populated
  find<const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params: { populate: '*' | true } & QueryParams<TBase, TFilters, '*' | true, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<TBase, '*'>, TBase, TFields>>
  // Overload: with populate array → populated return type
  find<const TPopulate extends readonly (keyof TPopulateKeys & string)[], const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params: { populate: TPopulate } & QueryParams<TBase, TFilters, TPopulate, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields>>
  // Overload: general case → base return type
  find<const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params?: QueryParams<TBase, TFilters, TPopulateKeys | (keyof TPopulateKeys & string)[] | '*' | boolean, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<TBase, TBase, TFields>>

  async find(params?: any, nextOptions?: any): Promise<any> {
    const query = this.buildQueryString(params)
    const url = \`\${this.config.baseURL}/api/\${this.endpoint}\${query}\`
    const response = await this.request<StrapiResponse<any>>(url, {}, nextOptions)
    return response.data
  }

  /** @deprecated Pass Next.js options as the third argument: \`update(data, {}, nextOptions)\`. */
  update(data: TUpdateInput | FormData, nextOptions: NextOptions): Promise<TBase>
  update(data: TUpdateInput | FormData, params?: WriteParams<TLocalized, TDraftAndPublish>, nextOptions?: NextOptions): Promise<TBase>

  async update(data: TUpdateInput | FormData, params?: any, nextOptions?: NextOptions): Promise<TBase> {
    ;[params, nextOptions] = this.splitWriteArgs(params, nextOptions)
    // If data is FormData, use it directly; otherwise wrap in { data } and JSON stringify
    const body = data instanceof FormData
      ? data
      : JSON.stringify({ data })

    const url = \`\${this.config.baseURL}/api/\${this.endpoint}\${this.buildQueryString(params)}\`
    const response = await this.request<StrapiResponse<TBase>>(
      url,
      {
        method: 'PUT',
        body,
      },
      nextOptions
    )
    return response.data
  }

  async delete(params?: DeleteParams<TLocalized>, nextOptions?: NextOptions): Promise<TBase | null> {
    const url = \`\${this.config.baseURL}/api/\${this.endpoint}\${this.buildQueryString(params)}\`
    const response = await this.request<StrapiResponse<TBase> | null>(
      url,
      {
        method: 'DELETE',
      },
      nextOptions
    )
    return response?.data ?? null
  }
}`
    }

    private generateUsersPermissionsUserAPI(): string {
        return `// Users & Permissions endpoint (/api/users) — sends and receives a flat
// payload, unlike standard content types which use the { data } envelope
class UsersPermissionsUserAPI<
  TBase,
  TCreateInput = Partial<TBase>,
  TUpdateInput = Partial<TBase>,
  TFilters = Record<string, any>,
  TPopulateKeys extends Record<string, any> = Record<string, any>,
  TLocalized extends boolean = boolean,
  TDraftAndPublish extends boolean = boolean
> extends CollectionAPI<TBase, TCreateInput, TUpdateInput, TFilters, TPopulateKeys, TLocalized, TDraftAndPublish> {
  protected override wrapBody(data: any): any {
    return data
  }

  protected override unwrap(response: any): any {
    return response
  }
}`
    }

    private generateCustomAPIClasses(
        schema: ParsedSchema,
        parsedRoutes: ParsedRoutes,
    ): string {
        const classes: string[] = []

        for (const [controller, routes] of parsedRoutes.byController) {
            // Skip auth and user controllers - they are handled specially
            if (controller === 'auth' || controller === 'user') {
                continue
            }

            // Find the corresponding content type by Strapi's singularName (= controller name)
            const contentType = schema.contentTypes.find(
                ct => ct.singularName === controller,
            )

            if (contentType) {
                const className = `${contentType.cleanName}API`
                const baseClass =
                    contentType.kind === 'single'
                        ? 'SingleTypeAPI'
                        : 'CollectionAPI'
                const typeParams = this.buildTypeParams(contentType)
                const endpoint =
                    contentType.kind === 'single'
                        ? contentType.singularName
                        : contentType.pluralName
                const customMethods =
                    this.customApiGenerator.generateCustomMethods(
                        controller,
                        routes,
                        false,
                        endpoint,
                        contentType.cleanName,
                    )

                classes.push(
                    `// Custom API class for ${contentType.cleanName} (${contentType.kind} type) with custom routes
class ${className} extends ${baseClass}${typeParams} {
${customMethods}
}`,
                )
            } else {
                // Standalone API class (no content type)
                const { className } = this.resolveStandaloneNames(
                    controller,
                    routes,
                    schema,
                )
                const customMethods =
                    this.customApiGenerator.generateCustomMethods(
                        controller,
                        routes,
                        true,
                    )

                classes.push(
                    `// Standalone API class for ${controller} controller
class ${className} extends BaseAPI {
  constructor(config: StrapiClientConfig) {
    super(config)
  }
${customMethods}
}`,
                )
            }
        }

        return classes.join('\n\n')
    }

    private buildTypeParams(contentType: ContentType): string {
        const hasPopulatableFields =
            contentType.relations.length > 0 ||
            contentType.media.length > 0 ||
            contentType.components.length > 0 ||
            contentType.dynamicZones.length > 0

        const name = contentType.cleanName
        const populate = hasPopulatableFields
            ? `${name}PopulateParam`
            : 'Record<string, any>'
        // An unknown flag stays `boolean`, which keeps both params open
        const localized = String(contentType.localized ?? 'boolean')
        const draftAndPublish = String(contentType.draftAndPublish ?? 'boolean')
        const inputs =
            contentType.kind === 'single'
                ? `${name}UpdateInput`
                : `${name}CreateInput, ${name}UpdateInput`
        return `<${name}, ${inputs}, ${name}Filters, ${populate}, ${localized}, ${draftAndPublish}>`
    }

    /**
     * Pick the API class wired for a content type. The users-permissions user
     * is special-cased to the flat-envelope class; everything else uses its
     * custom-route class, SingleTypeAPI, or CollectionAPI.
     */
    private resolveContentTypeApiClass(
        contentType: ContentType,
        hasCustomRoutes: boolean,
    ): string {
        if (contentType.name === USERS_PERMISSIONS_USER) {
            return 'UsersPermissionsUserAPI'
        }
        if (hasCustomRoutes) {
            return `${contentType.cleanName}API`
        }
        return contentType.kind === 'single' ? 'SingleTypeAPI' : 'CollectionAPI'
    }

    /**
     * Compute which entries of `PLUGIN_REGISTRY` should be active for the
     * current generation. An entry is skipped if the user has a custom
     * standalone controller that resolves to the same property name —
     * avoiding both class-name and StrapiClient property collisions. A
     * single warning per skipped entry is logged.
     */
    private computeActivePlugins(
        schema: ParsedSchema,
        parsedRoutes?: ParsedRoutes,
    ): typeof PLUGIN_REGISTRY {
        return PLUGIN_REGISTRY.filter(contract => {
            const collidesWithUserController =
                parsedRoutes?.byController.has(contract.clientProperty) &&
                !schema.contentTypes.some(
                    ct => ct.singularName === contract.clientProperty,
                )
            if (collidesWithUserController) {
                console.warn(
                    `[strapi-types] Custom '${contract.clientProperty}' controller detected — ` +
                        `skipping built-in ${contract.className} to avoid name collision.`,
                )
                return false
            }
            return true
        })
    }

    private generateStrapiClient(
        schema: ParsedSchema,
        parsedRoutes?: ParsedRoutes,
        activePlugins: typeof PLUGIN_REGISTRY = PLUGIN_REGISTRY,
    ): string {
        // Build property declarations
        const propertyDeclarations = schema.contentTypes
            .map(contentType => {
                const endpoint =
                    contentType.kind === 'single'
                        ? contentType.singularName
                        : contentType.pluralName
                const controllerName = contentType.singularName
                const hasCustomRoutes =
                    parsedRoutes?.byController.has(controllerName) &&
                    controllerName !== 'auth' &&
                    controllerName !== 'user'
                const apiClass = this.resolveContentTypeApiClass(
                    contentType,
                    !!hasCustomRoutes,
                )
                const propName = this.contentTypePropName(
                    endpoint,
                    contentType.kind,
                )
                const typeParam = hasCustomRoutes
                    ? ''
                    : this.buildTypeParams(contentType)
                return `  ${propName}: ${apiClass}${typeParam}`
            })
            .join('\n')

        // Build standalone API property declarations
        const standaloneDeclarations = this.buildStandaloneDeclarations(
            schema,
            parsedRoutes,
        )

        // Build constructor initializations
        const propertyInits = schema.contentTypes
            .map(contentType => {
                const endpoint =
                    contentType.kind === 'single'
                        ? contentType.singularName
                        : contentType.pluralName
                const controllerName = contentType.singularName
                const hasCustomRoutes =
                    parsedRoutes?.byController.has(controllerName) &&
                    controllerName !== 'auth' &&
                    controllerName !== 'user'
                const apiClass = this.resolveContentTypeApiClass(
                    contentType,
                    !!hasCustomRoutes,
                )
                const propName = this.contentTypePropName(
                    endpoint,
                    contentType.kind,
                )

                // Determine final endpoint with plugin prefix
                // Plugin content types get prefix by default, unless routes explicitly set prefix: ''
                let finalEndpoint = endpoint
                if (contentType.pluginName) {
                    const controllerRoutes =
                        parsedRoutes?.byController.get(controllerName)
                    const hasEmptyPrefix = controllerRoutes?.some(
                        r => r.prefix === '',
                    )
                    if (!hasEmptyPrefix) {
                        finalEndpoint = `${contentType.pluginName}/${endpoint}`
                    }
                }

                return `    this.${propName} = new ${apiClass}('${finalEndpoint}', this.config)`
            })
            .join('\n')

        // Build standalone API initializations
        const standaloneInits = this.buildStandaloneInits(schema, parsedRoutes)

        // Plugin APIs from PLUGIN_REGISTRY — `activePlugins` is precomputed
        // by the caller (see computeActivePlugins) so the same filter is
        // applied to both class emission and StrapiClient wiring.
        const pluginDeclarations = activePlugins
            .map(c => `  ${c.clientProperty}: ${c.className}`)
            .join('\n')

        const pluginInits = activePlugins
            .map(
                c =>
                    `    this.${c.clientProperty} = new ${c.className}(this.config)`,
            )
            .join('\n')

        const pluginDeclarationsBlock = pluginDeclarations
            ? `\n  // Plugin APIs (registry-driven)\n${pluginDeclarations}\n`
            : ''
        const pluginInitsBlock = pluginInits
            ? `\n    // Initialize plugin APIs\n${pluginInits}\n`
            : ''

        const usersPermissions = hasUsersPermissions(schema)
        const authDeclarationBlock = usersPermissions
            ? `
  // Auth API for users-permissions plugin
  auth: AuthAPI
  /** @deprecated Use \`auth\` instead. Will be removed in a future major. */
  get authentication(): AuthAPI {
    return this.auth
  }`
            : ''
        const authInitBlock = usersPermissions
            ? `
    // Initialize Auth API
    this.auth = new AuthAPI(this.config)`
            : ''

        return `// Main Strapi client
export class StrapiClient {
  private config: StrapiClientConfig
${authDeclarationBlock}
${pluginDeclarationsBlock}
${propertyDeclarations}
${standaloneDeclarations}
  constructor(config: StrapiClientConfig) {
    this.config = config
${authInitBlock}
${pluginInitsBlock}
${propertyInits}
${standaloneInits}
    // Auto-validate schema in development mode
    if (config.validateSchema) {
      this.validateSchema().then(result => {
        if (!result.valid && result.remoteHash) {
          console.warn(\`[Strapi Types] Schema mismatch detected!\`)
          console.warn(\`  Local:  \${result.localHash.slice(0, 8)}...\`)
          console.warn(\`  Remote: \${result.remoteHash.slice(0, 8)}...\`)
          console.warn('  Run "npx strapi-types generate" to update types.')
        }
      }).catch(() => {
        // Silently ignore validation errors (e.g., plugin not installed)
      })
    }
  }

  /** @deprecated For user sessions prefer the built-in session flow (refresh mode); for other dynamic tokens use \`config.onRequest\`. \`setToken\` still works for now. */
  setToken(token: string) {
    this.config.token = token
  }

  /**
   * Validate that local types match the remote Strapi schema.
   * Useful for detecting schema drift in development.
   * @returns Promise<{ valid: boolean; localHash: string; remoteHash?: string; error?: string }>
   */
  async validateSchema(): Promise<{
    valid: boolean
    localHash: string
    remoteHash?: string
    error?: string
  }> {
    try {
      const response = await fetch(\`\${this.config.baseURL}${SCHEMA_API_PREFIX}/schema-hash\`)
      if (!response.ok) {
        return {
          valid: false,
          localHash: SCHEMA_HASH,
          error: \`Failed to fetch remote schema: \${response.status}\`
        }
      }
      const { hash: remoteHash } = await response.json()
      const valid = SCHEMA_HASH === remoteHash
      if (!valid && this.config.debug) {
        console.warn(\`[Strapi Types] Schema mismatch! Local: \${SCHEMA_HASH.slice(0, 8)}... Remote: \${remoteHash.slice(0, 8)}...\`)
        console.warn('[Strapi Types] Run "npx strapi-types generate" to update types.')
      }
      return { valid, localHash: SCHEMA_HASH, remoteHash }
    } catch (error) {
      return {
        valid: false,
        localHash: 'unknown',
        error: (error as Error).message
      }
    }
  }
}`
    }

    /**
     * Resolve the class + property name for a standalone controller (one that
     * does not correspond to a content type).
     *
     * A plugin-route controller can share a name with another content type's
     * pluralName — e.g. the users-permissions plugin's `permissions` controller
     * (which serves /api/users-permissions/permissions) vs a `Permission`
     * content type whose pluralName is `permissions` (which serves
     * /api/permissions). These are two distinct endpoints, and we want both on
     * the client. When this collision occurs, disambiguate the standalone name
     * by prefixing it with the plugin's camelCase name.
     */
    /**
     * Property name for a content type on StrapiClient. `auth` (and its
     * deprecated alias `authentication`) are reserved for the users-permissions
     * namespace, so a content type whose endpoint camelCases to one of those is
     * disambiguated by kind (e.g. a single type `auth` → `authSingle`) to avoid
     * a duplicate-identifier collision with `auth: AuthAPI`.
     */
    private contentTypePropName(
        endpoint: string,
        kind: 'single' | 'collection',
    ): string {
        const base = toCamelCase(endpoint)
        if (base !== 'auth' && base !== 'authentication') return base
        return base + (kind === 'single' ? 'Single' : 'Collection')
    }

    private resolveStandaloneNames(
        controller: string,
        routes: ParsedRoute[],
        schema: ParsedSchema,
    ): { className: string; propName: string } {
        const collides = schema.contentTypes.some(
            ct => ct.pluralName === controller,
        )
        const pluginName = routes.find(r => r.pluginName)?.pluginName

        if (collides && pluginName) {
            return {
                className:
                    toPascalCase(pluginName) + toPascalCase(controller) + 'API',
                propName: toCamelCase(pluginName) + toPascalCase(controller),
            }
        }

        return {
            className: toPascalCase(controller) + 'API',
            propName: toCamelCase(controller),
        }
    }

    private buildStandaloneDeclarations(
        schema: ParsedSchema,
        parsedRoutes?: ParsedRoutes,
    ): string {
        if (!parsedRoutes) return ''

        const declarations: string[] = []
        for (const [controller, routes] of parsedRoutes.byController) {
            if (controller === 'auth' || controller === 'user') continue

            const hasContentType = schema.contentTypes.some(
                ct => ct.singularName === controller,
            )

            if (!hasContentType) {
                const { className, propName } = this.resolveStandaloneNames(
                    controller,
                    routes,
                    schema,
                )
                declarations.push(`  ${propName}: ${className}`)
            }
        }

        return declarations.join('\n')
    }

    private buildStandaloneInits(
        schema: ParsedSchema,
        parsedRoutes?: ParsedRoutes,
    ): string {
        if (!parsedRoutes) return ''

        const inits: string[] = []
        for (const [controller, routes] of parsedRoutes.byController) {
            if (controller === 'auth' || controller === 'user') continue

            const hasContentType = schema.contentTypes.some(
                ct => ct.singularName === controller,
            )

            if (!hasContentType) {
                const { className, propName } = this.resolveStandaloneNames(
                    controller,
                    routes,
                    schema,
                )
                inits.push(
                    `    this.${propName} = new ${className}(this.config)`,
                )
            }
        }

        return inits.join('\n')
    }
}
