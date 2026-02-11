import { ParsedSchema, ContentType } from '../schema-types.js'
import { TypeTransformer } from '../transformer/index.js'
import { AuthApiGenerator } from './auth-api-generator.js'
import { RoutesParser, ParsedRoutes } from '../parser/routes-parser.js'
import { CustomApiGenerator } from './custom-api-generator.js'
import { CustomTypesParser } from '../parser/custom-types-parser.js'
import { toCamelCase, toPascalCase } from '../shared/index.js'
import type {
    ParsedEndpoint,
    ExtraControllerType,
} from '../shared/endpoint-types.js'
import {
    convertEndpointsToRoutes,
    convertEndpointsToCustomTypes,
} from '../core/endpoint-converter.js'
import * as path from 'path'

export class ClientGenerator {
    private transformer: TypeTransformer
    private authApiGenerator: AuthApiGenerator
    private routesParser: RoutesParser
    private customApiGenerator: CustomApiGenerator
    private customTypesParser: CustomTypesParser

    constructor() {
        this.transformer = new TypeTransformer()
        this.authApiGenerator = new AuthApiGenerator()
        this.routesParser = new RoutesParser()
        this.customApiGenerator = new CustomApiGenerator()
        this.customTypesParser = new CustomTypesParser()
    }

    generate(
        schema: ParsedSchema,
        inputDir?: string,
        endpoints?: ParsedEndpoint[],
        extraTypes?: ExtraControllerType[],
    ): string {
        const lines: string[] = []

        // Parse custom routes and custom types
        let parsedRoutes: ParsedRoutes | undefined

        if (endpoints && endpoints.length > 0) {
            // Remote mode: convert endpoints from Strapi plugin
            parsedRoutes = convertEndpointsToRoutes(endpoints)
            const customTypes = convertEndpointsToCustomTypes(
                endpoints,
                extraTypes,
            )
            this.customApiGenerator.setCustomTypes(customTypes)
        } else if (inputDir) {
            // Local mode: parse from filesystem
            const routesDir = path.join(inputDir, 'routes')
            parsedRoutes = this.routesParser.parse(routesDir)

            // Parse custom types
            const customTypes = this.customTypesParser.parse(inputDir)
            this.customApiGenerator.setCustomTypes(customTypes)
        }

        // Add header comment
        lines.push('// Auto-generated Strapi API client')
        lines.push('// Do not edit manually')
        lines.push('')

        // Add imports
        lines.push(this.generateImports(schema))
        lines.push('')

        // Add custom type definitions (if any)
        const customTypeDefs = this.customApiGenerator.generateTypeDefinitions()
        if (customTypeDefs) {
            lines.push(customTypeDefs)
            lines.push('')
        }

        // Generate utility types
        lines.push(this.generateUtilityTypes(schema))
        lines.push('')

        // Generate auth types
        lines.push(this.authApiGenerator.generateAuthTypes())
        lines.push('')

        // Generate CollectionAPI class
        lines.push(this.generateCollectionAPI())
        lines.push('')

        // Generate SingleTypeAPI class
        lines.push(this.generateSingleTypeAPI())
        lines.push('')

        // Generate custom API classes (for collections with custom routes)
        if (parsedRoutes) {
            lines.push(this.generateCustomAPIClasses(schema, parsedRoutes))
            lines.push('')
        }

        // Generate AuthAPI class (with dynamic methods if auth/user routes found)
        const authRoutes = parsedRoutes?.byController.get('auth') || []
        const userRoutes = parsedRoutes?.byController.get('user') || []
        lines.push(
            this.authApiGenerator.generateAuthApiClass(authRoutes, userRoutes),
        )
        lines.push('')

        // Generate main StrapiClient class
        lines.push(this.generateStrapiClient(schema, parsedRoutes))
        lines.push('')

        return lines.join('\n')
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

            // Add Input type for create/update operations
            imports.push(`${ct.cleanName}Input`)

            // Add Filter type for type-safe filtering
            filterImports.push(`${ct.cleanName}Filters`)
        }

        // Add MediaFile to imports
        imports.push('MediaFile')

        // Ensure User is imported for Auth types (if not already)
        if (!imports.includes('User')) {
            imports.push('User')
        }

        // Ensure UserPopulateParam is imported (for AuthAPI me/updateMe overloads)
        if (!imports.includes('UserPopulateParam')) {
            // Check if User has populatable fields
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
        if (!filterImports.includes('UserFilters')) {
            filterImports.push('UserFilters')
        }

        // Add filter utility types
        filterImports.push(
            'StringFilterOperators',
            'NumberFilterOperators',
            'BooleanFilterOperators',
            'DateFilterOperators',
            'IdFilterOperators',
            'LogicalOperators',
        )

        return `import type { ${imports.join(', ')} } from './types.js'
import type { ${filterImports.join(', ')} } from './types.js'
import qs from 'qs'`
    }

    private generateUtilityTypes(schema: ParsedSchema): string {
        const lines: string[] = []

        lines.push('// Utility types for query parameters')
        lines.push('')
        lines.push('export interface StrapiResponse<T> {')
        lines.push('  data: T')
        lines.push('  meta?: {')
        lines.push('    pagination?: {')
        lines.push('      page: number')
        lines.push('      pageSize: number')
        lines.push('      pageCount: number')
        lines.push('      total: number')
        lines.push('    }')
        lines.push('  }')
        lines.push('}')
        lines.push('')
        lines.push('// Custom error class for Strapi API errors')
        lines.push('export class StrapiError extends Error {')
        lines.push('  /** Clean user-friendly message from Strapi backend */')
        lines.push('  userMessage: string')
        lines.push('  /** HTTP status code */')
        lines.push('  status: number')
        lines.push('  /** HTTP status text */')
        lines.push('  statusText: string')
        lines.push('  /** Additional error details from Strapi */')
        lines.push('  details?: any')
        lines.push('')
        lines.push('  constructor(')
        lines.push('    message: string,')
        lines.push('    userMessage: string,')
        lines.push('    status: number,')
        lines.push('    statusText: string,')
        lines.push('    details?: any')
        lines.push('  ) {')
        lines.push('    super(message)')
        lines.push('    this.name = "StrapiError"')
        lines.push('    this.userMessage = userMessage')
        lines.push('    this.status = status')
        lines.push('    this.statusText = statusText')
        lines.push('    this.details = details')
        lines.push('  }')
        lines.push('}')
        lines.push('')
        lines.push('// Base API class with shared logic')
        lines.push('class BaseAPI {')
        lines.push('  constructor(protected config: StrapiClientConfig) {}')
        lines.push('')
        lines.push('  protected async request<R>(')
        lines.push('    url: string,')
        lines.push('    options: RequestInit = {},')
        lines.push('    nextOptions?: NextOptions,')
        lines.push("    errorPrefix = 'Strapi API'")
        lines.push('  ): Promise<R> {')
        lines.push('    const fetchFn = this.config.fetch || globalThis.fetch')
        lines.push('')
        lines.push('    if (this.config.debug) {')
        lines.push(
            "      console.log(`[${errorPrefix}] ${options.method || 'GET'} ${url}`)",
        )
        lines.push('    }')
        lines.push('')
        lines.push('    const headers: Record<string, string> = {')
        lines.push('      ...options.headers as Record<string, string>,')
        lines.push('    }')
        lines.push('')
        lines.push(
            '    // Only add Content-Type for JSON, let browser set it for FormData',
        )
        lines.push('    if (!(options.body instanceof FormData)) {')
        lines.push("      headers['Content-Type'] = 'application/json'")
        lines.push('    }')
        lines.push('')
        lines.push('    if (this.config.token) {')
        lines.push(
            "      headers['Authorization'] = `Bearer ${this.config.token}`",
        )
        lines.push('    }')
        lines.push('')
        lines.push('    const fetchOptions: RequestInit = {')
        lines.push('      ...options,')
        lines.push('      headers,')
        lines.push(
            '      ...(this.config.credentials && { credentials: this.config.credentials }),',
        )
        lines.push('    }')
        lines.push('')
        lines.push('    // Add Next.js cache options if provided')
        lines.push('    if (nextOptions) {')
        lines.push(
            '      if (nextOptions.revalidate !== undefined || nextOptions.tags) {',
        )
        lines.push('        fetchOptions.next = {')
        lines.push(
            '          ...(nextOptions.revalidate !== undefined && { revalidate: nextOptions.revalidate }),',
        )
        lines.push(
            '          ...(nextOptions.tags && { tags: nextOptions.tags }),',
        )
        lines.push('        } as any')
        lines.push('      }')
        lines.push('      if (nextOptions.cache) {')
        lines.push('        fetchOptions.cache = nextOptions.cache')
        lines.push('      }')
        lines.push('    }')
        lines.push('')
        lines.push('    const response = await fetchFn(url, fetchOptions)')
        lines.push('')
        lines.push('    if (!response.ok) {')
        lines.push(
            '      const errorData = await response.json().catch(() => ({}))',
        )
        lines.push(
            '      const userMessage = errorData.error?.message || response.statusText',
        )
        lines.push(
            "      const technicalMessage = `${errorPrefix} error: ${response.status} ${response.statusText}${errorData.error?.message ? ' - ' + errorData.error.message : ''}`",
        )
        lines.push('      throw new StrapiError(')
        lines.push('        technicalMessage,')
        lines.push('        userMessage,')
        lines.push('        response.status,')
        lines.push('        response.statusText,')
        lines.push('        errorData.error?.details')
        lines.push('      )')
        lines.push('    }')
        lines.push('')
        lines.push(
            '    // Handle 204 No Content (e.g., from DELETE operations)',
        )
        lines.push('    if (response.status === 204) {')
        lines.push('      return null as R')
        lines.push('    }')
        lines.push('')
        lines.push('    return response.json()')
        lines.push('  }')
        lines.push('')
        lines.push(
            '  protected buildQueryString(params?: QueryParams): string {',
        )
        lines.push("    if (!params) return ''")
        lines.push('')
        lines.push('    const queryString = qs.stringify(params, {')
        lines.push('      encodeValuesOnly: true,')
        lines.push('      skipNulls: true,')
        lines.push('    })')
        lines.push('')
        lines.push("    return queryString ? `?${queryString}` : ''")
        lines.push('  }')
        lines.push('}')
        lines.push('')
        lines.push(
            'type StrapiSortOption<T> = Exclude<keyof T & string, \'__typename\'> | `${Exclude<keyof T & string, \'__typename\'>}:${"asc" | "desc"}`',
        )
        lines.push('')
        lines.push(
            "export interface QueryParams<TEntity = any, TFilters = Record<string, any>, TPopulate = any, TFields extends string = Exclude<keyof TEntity & string, '__typename'>> {",
        )
        lines.push('  filters?: TFilters')
        lines.push(
            '  sort?: StrapiSortOption<TEntity> | StrapiSortOption<TEntity>[]',
        )
        lines.push('  pagination?: {')
        lines.push('    page?: number')
        lines.push('    pageSize?: number')
        lines.push('    limit?: number')
        lines.push('    start?: number')
        lines.push('  }')
        lines.push('  populate?: TPopulate')
        lines.push('  fields?: TFields[]')
        lines.push('}')
        lines.push('')
        lines.push('export interface NextOptions {')
        lines.push('  revalidate?: number | false')
        lines.push('  tags?: string[]')
        lines.push('  cache?: RequestCache')
        lines.push('}')
        lines.push('')
        lines.push('export interface StrapiClientConfig {')
        lines.push('  baseURL: string')
        lines.push('  token?: string')
        lines.push('  fetch?: typeof fetch')
        lines.push('  debug?: boolean')
        lines.push('  credentials?: RequestCredentials')
        lines.push(
            '  /** Enable schema validation on init (dev mode). Logs warning if types are outdated. */',
        )
        lines.push('  validateSchema?: boolean')
        lines.push('}')
        lines.push('')
        lines.push('// Utility type for exact type equality check')
        lines.push('type Equal<X, Y> =')
        lines.push('  (<T>() => T extends X ? 1 : 2) extends')
        lines.push('  (<T>() => T extends Y ? 1 : 2) ? true : false')
        lines.push('')
        lines.push(
            '// Utility type to automatically infer populated type based on base type',
        )
        lines.push(
            '// Uses exact equality instead of extends to avoid structural typing issues',
        )
        lines.push('type GetPopulated<TBase, TPopulate> =')

        // Generate conditional type for each content type with GetPayload
        const typesWithPayload = schema.contentTypes.filter(
            ct =>
                ct.relations.length > 0 ||
                ct.media.length > 0 ||
                ct.components.length > 0 ||
                ct.dynamicZones.length > 0,
        )

        for (let i = 0; i < typesWithPayload.length; i++) {
            const ct = typesWithPayload[i]

            lines.push(
                `  Equal<TBase, ${ct.cleanName}> extends true ? ${ct.cleanName}GetPayload<{ populate: TPopulate }> :`,
            )
        }

        lines.push('  TBase')
        lines.push('')
        lines.push(
            '// Utility type for narrowing return type based on fields parameter',
        )
        lines.push('type SelectFields<TFull, TBase, TFields extends string> =')
        lines.push(
            "  [TFields] extends [never] ? TFull : Pick<TBase, Extract<TFields | 'id' | 'documentId', keyof TBase>> & Omit<TFull, keyof TBase>",
        )

        return lines.join('\n')
    }

    private generateCollectionAPI(): string {
        return `// Collection API wrapper with type-safe populate support
class CollectionAPI<
  TBase,
  TInput = Partial<TBase>,
  TFilters = Record<string, any>,
  TPopulateKeys extends Record<string, any> = Record<string, any>
> extends BaseAPI {
  constructor(
    private endpoint: string,
    config: StrapiClientConfig
  ) {
    super(config)
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
  // Overload: general case → base return type
  find<const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    params?: QueryParams<TBase, TFilters, TPopulateKeys | (keyof TPopulateKeys & string)[] | '*' | boolean, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<TBase, TBase, TFields>[]>

  async find(params?: any, nextOptions?: any): Promise<any> {
    const query = this.buildQueryString(params)
    const url = \`\${this.config.baseURL}/api/\${this.endpoint}\${query}\`
    const response = await this.request<StrapiResponse<any[]>>(url, {}, nextOptions)
    return response.data
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
  ): Promise<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields> | null>
  // Overload: with populate '*' or true → all fields populated
  findOne<const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    documentId: string,
    params: { populate: '*' | true } & QueryParams<TBase, TFilters, '*' | true, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<TBase, '*'>, TBase, TFields> | null>
  // Overload: general case → base return type
  findOne<const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    documentId: string,
    params?: QueryParams<TBase, TFilters, TPopulateKeys | (keyof TPopulateKeys & string)[] | '*' | boolean, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<TBase, TBase, TFields> | null>

  async findOne(documentId: string, params?: any, nextOptions?: any): Promise<any> {
    const query = this.buildQueryString(params)
    const url = \`\${this.config.baseURL}/api/\${this.endpoint}/\${documentId}\${query}\`
    const response = await this.request<StrapiResponse<any>>(url, {}, nextOptions)
    return response.data
  }

  async create(data: TInput | FormData, nextOptions?: NextOptions): Promise<TBase> {
    // If data is FormData, use it directly; otherwise wrap in { data } and JSON stringify
    const body = data instanceof FormData
      ? data
      : JSON.stringify({ data })

    const url = \`\${this.config.baseURL}/api/\${this.endpoint}\`
    const response = await this.request<StrapiResponse<TBase>>(
      url,
      {
        method: 'POST',
        body,
      },
      nextOptions
    )
    return response.data
  }

  async update(documentId: string, data: TInput | FormData, nextOptions?: NextOptions): Promise<TBase> {
    // If data is FormData, use it directly; otherwise wrap in { data } and JSON stringify
    const body = data instanceof FormData
      ? data
      : JSON.stringify({ data })

    const url = \`\${this.config.baseURL}/api/\${this.endpoint}/\${documentId}\`
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

  async delete(documentId: string, nextOptions?: NextOptions): Promise<TBase | null> {
    const url = \`\${this.config.baseURL}/api/\${this.endpoint}/\${documentId}\`
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

    private generateSingleTypeAPI(): string {
        return `// Single Type API wrapper with type-safe populate support
class SingleTypeAPI<
  TBase,
  TInput = Partial<TBase>,
  TFilters = Record<string, any>,
  TPopulateKeys extends Record<string, any> = Record<string, any>
> extends BaseAPI {
  constructor(
    private endpoint: string,
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

  async update(data: TInput | FormData, nextOptions?: NextOptions): Promise<TBase> {
    // If data is FormData, use it directly; otherwise wrap in { data } and JSON stringify
    const body = data instanceof FormData
      ? data
      : JSON.stringify({ data })

    const url = \`\${this.config.baseURL}/api/\${this.endpoint}\`
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
}`
    }

    private generateCustomAPIClasses(
        schema: ParsedSchema,
        parsedRoutes: ParsedRoutes,
    ): string {
        const lines: string[] = []

        // For each controller with custom routes, generate an extended API class
        for (const [controller, routes] of parsedRoutes.byController) {
            // Skip auth and user controllers - they are handled specially
            if (controller === 'auth' || controller === 'user') {
                continue
            }

            // Find the corresponding content type
            const contentType = schema.contentTypes.find(
                ct =>
                    this.transformer
                        .toEndpointName(ct.cleanName, false)
                        .replace(/s$/, '') === controller,
            )

            // If content type exists (collection or single), extend the appropriate API class
            if (contentType) {
                const className = `${contentType.cleanName}API`
                const baseClass =
                    contentType.kind === 'single'
                        ? 'SingleTypeAPI'
                        : 'CollectionAPI'
                const typeParams = this.buildTypeParams(contentType)

                lines.push(
                    `// Custom API class for ${contentType.cleanName} (${contentType.kind} type) with custom routes`,
                )
                lines.push(
                    `class ${className} extends ${baseClass}${typeParams} {`,
                )

                // Generate custom methods (not standalone)
                lines.push(
                    this.customApiGenerator.generateCustomMethods(
                        controller,
                        routes,
                        false,
                    ),
                )

                lines.push('}')
                lines.push('')
            }
            // If no content type found, create a standalone API class
            else {
                const className = toPascalCase(controller) + 'API'

                lines.push(
                    `// Standalone API class for ${controller} controller`,
                )
                lines.push(`class ${className} extends BaseAPI {`)
                lines.push(`  constructor(config: StrapiClientConfig) {`)
                lines.push(`    super(config)`)
                lines.push(`  }`)

                // Generate custom methods (standalone)
                lines.push(
                    this.customApiGenerator.generateCustomMethods(
                        controller,
                        routes,
                        true,
                    ),
                )

                lines.push('}')
                lines.push('')
            }
        }

        return lines.join('\n')
    }

    private buildTypeParams(contentType: ContentType): string {
        const hasPopulatableFields =
            contentType.relations.length > 0 ||
            contentType.media.length > 0 ||
            contentType.components.length > 0 ||
            contentType.dynamicZones.length > 0

        if (hasPopulatableFields) {
            return `<${contentType.cleanName}, ${contentType.cleanName}Input, ${contentType.cleanName}Filters, ${contentType.cleanName}PopulateParam>`
        }
        return `<${contentType.cleanName}, ${contentType.cleanName}Input, ${contentType.cleanName}Filters>`
    }

    private generateStrapiClient(
        schema: ParsedSchema,
        parsedRoutes?: ParsedRoutes,
    ): string {
        const lines: string[] = []

        lines.push('// Main Strapi client')
        lines.push('export class StrapiClient {')
        lines.push('  private config: StrapiClientConfig')
        lines.push('')
        lines.push('  // Auth API for users-permissions plugin')
        lines.push('  authentication: AuthAPI')
        lines.push('')

        // Generate collection/single type properties
        for (const contentType of schema.contentTypes) {
            const endpoint = this.transformer.toEndpointName(
                contentType.cleanName,
                contentType.kind === 'single',
            )

            // Check if this content type has custom routes (excluding auth and user)
            const controllerName = endpoint.replace(/s$/, '')
            const hasCustomRoutes =
                parsedRoutes?.byController.has(controllerName) &&
                controllerName !== 'auth' &&
                controllerName !== 'user'

            // Determine API class name based on whether it has custom routes
            const apiClass = hasCustomRoutes
                ? `${contentType.cleanName}API`
                : contentType.kind === 'single'
                  ? 'SingleTypeAPI'
                  : 'CollectionAPI'

            const propName = toCamelCase(endpoint)

            // Generate type parameters for standard API classes (not for custom route classes)
            const typeParam = hasCustomRoutes
                ? ''
                : this.buildTypeParams(contentType)

            lines.push(`  ${propName}: ${apiClass}${typeParam}`)
        }

        // Add standalone API properties (controllers without corresponding content types)
        if (parsedRoutes) {
            for (const [controller] of parsedRoutes.byController) {
                // Skip auth and user controllers - they are handled specially
                if (controller === 'auth' || controller === 'user') {
                    continue
                }

                // Check if this controller has a corresponding content type
                const hasContentType = schema.contentTypes.some(
                    ct =>
                        this.transformer
                            .toEndpointName(ct.cleanName, false)
                            .replace(/s$/, '') === controller,
                )

                // If no content type found, add standalone API property
                if (!hasContentType) {
                    const className = toPascalCase(controller) + 'API'
                    const propName = toCamelCase(controller)

                    lines.push(`  ${propName}: ${className}`)
                }
            }
        }

        lines.push('')
        lines.push('  constructor(config: StrapiClientConfig) {')
        lines.push('    this.config = config')
        lines.push('')
        lines.push('    // Initialize Auth API')
        lines.push('    this.authentication = new AuthAPI(this.config)')
        lines.push('')

        // Initialize collection/single type properties
        for (const contentType of schema.contentTypes) {
            const endpoint = this.transformer.toEndpointName(
                contentType.cleanName,
                contentType.kind === 'single',
            )

            // Check if this content type has custom routes (excluding auth and user)
            const controllerName = endpoint.replace(/s$/, '')
            const hasCustomRoutes =
                parsedRoutes?.byController.has(controllerName) &&
                controllerName !== 'auth' &&
                controllerName !== 'user'

            // Determine API class name based on whether it has custom routes
            const apiClass = hasCustomRoutes
                ? `${contentType.cleanName}API`
                : contentType.kind === 'single'
                  ? 'SingleTypeAPI'
                  : 'CollectionAPI'

            const propName = toCamelCase(endpoint)

            lines.push(
                `    this.${propName} = new ${apiClass}('${endpoint}', this.config)`,
            )
        }

        // Initialize standalone API properties
        if (parsedRoutes) {
            for (const [controller] of parsedRoutes.byController) {
                // Skip auth and user controllers - they are handled specially
                if (controller === 'auth' || controller === 'user') {
                    continue
                }

                // Check if this controller has a corresponding content type
                const hasContentType = schema.contentTypes.some(
                    ct =>
                        this.transformer
                            .toEndpointName(ct.cleanName, false)
                            .replace(/s$/, '') === controller,
                )

                // If no content type found, initialize standalone API
                if (!hasContentType) {
                    const className = toPascalCase(controller) + 'API'
                    const propName = toCamelCase(controller)

                    lines.push(
                        `    this.${propName} = new ${className}(this.config)`,
                    )
                }
            }
        }

        lines.push('')
        lines.push('    // Auto-validate schema in development mode')
        lines.push('    if (config.validateSchema) {')
        lines.push('      this.validateSchema().then(result => {')
        lines.push('        if (!result.valid && result.remoteHash) {')
        lines.push(
            '          console.warn(`[Strapi Types] Schema mismatch detected!`)',
        )
        lines.push(
            '          console.warn(`  Local:  ${result.localHash.slice(0, 8)}...`)',
        )
        lines.push(
            '          console.warn(`  Remote: ${result.remoteHash.slice(0, 8)}...`)',
        )
        lines.push(
            '          console.warn(\'  Run "npx strapi-types generate" to update types.\')',
        )
        lines.push('        }')
        lines.push('      }).catch(() => {')
        lines.push(
            '        // Silently ignore validation errors (e.g., plugin not installed)',
        )
        lines.push('      })')
        lines.push('    }')
        lines.push('  }')
        lines.push('')
        lines.push('  setToken(token: string) {')
        lines.push('    this.config.token = token')
        lines.push('  }')
        lines.push('')
        lines.push('  /**')
        lines.push(
            '   * Validate that local types match the remote Strapi schema.',
        )
        lines.push('   * Useful for detecting schema drift in development.')
        lines.push(
            '   * @returns Promise<{ valid: boolean; localHash: string; remoteHash?: string; error?: string }>',
        )
        lines.push('   */')
        lines.push('  async validateSchema(): Promise<{')
        lines.push('    valid: boolean')
        lines.push('    localHash: string')
        lines.push('    remoteHash?: string')
        lines.push('    error?: string')
        lines.push('  }> {')
        lines.push('    try {')
        lines.push(
            '      const { SCHEMA_HASH } = await import("./schema-meta.js")',
        )
        lines.push(
            '      const response = await fetch(`${this.config.baseURL}/api/strapi-types/schema-hash`)',
        )
        lines.push('      if (!response.ok) {')
        lines.push('        return {')
        lines.push('          valid: false,')
        lines.push('          localHash: SCHEMA_HASH,')
        lines.push(
            '          error: `Failed to fetch remote schema: ${response.status}`',
        )
        lines.push('        }')
        lines.push('      }')
        lines.push('      const { hash: remoteHash } = await response.json()')
        lines.push('      const valid = SCHEMA_HASH === remoteHash')
        lines.push('      if (!valid && this.config.debug) {')
        lines.push(
            '        console.warn(`[Strapi Types] Schema mismatch! Local: ${SCHEMA_HASH.slice(0, 8)}... Remote: ${remoteHash.slice(0, 8)}...`)',
        )
        lines.push(
            '        console.warn(\'[Strapi Types] Run "npx strapi-types generate" to update types.\')',
        )
        lines.push('      }')
        lines.push('      return { valid, localHash: SCHEMA_HASH, remoteHash }')
        lines.push('    } catch (error) {')
        lines.push('      return {')
        lines.push('        valid: false,')
        lines.push("        localHash: 'unknown',")
        lines.push('        error: (error as Error).message')
        lines.push('      }')
        lines.push('    }')
        lines.push('  }')
        lines.push('}')

        return lines.join('\n')
    }
}
