import { Project, SourceFile } from 'ts-morph'
import { ParsedSchema, ContentType } from '../schema-types.js'
import { TypeTransformer } from '../transformer/index.js'
import { AuthApiGenerator } from './auth-api-generator.js'
import type { ParsedRoutes } from '../shared/route-types.js'
import { CustomApiGenerator } from './custom-api-generator.js'
import { toCamelCase, toPascalCase } from '../shared/index.js'
import type {
    ParsedEndpoint,
    ExtraControllerType,
} from '../shared/endpoint-types.js'
import {
    convertEndpointsToRoutes,
    convertEndpointsToCustomTypes,
} from '../core/endpoint-converter.js'

export class ClientGenerator {
    private transformer: TypeTransformer
    private authApiGenerator: AuthApiGenerator
    private customApiGenerator: CustomApiGenerator

    constructor() {
        this.transformer = new TypeTransformer()
        this.authApiGenerator = new AuthApiGenerator()
        this.customApiGenerator = new CustomApiGenerator()
    }

    generate(
        schema: ParsedSchema,
        endpoints?: ParsedEndpoint[],
        extraTypes?: ExtraControllerType[],
    ): string {
        const project = new Project({ useInMemoryFileSystem: true })
        const sf = project.createSourceFile('client.ts')

        // Parse custom routes and custom types
        let parsedRoutes: ParsedRoutes | undefined

        if (endpoints && endpoints.length > 0) {
            parsedRoutes = convertEndpointsToRoutes(endpoints)
            const customTypes = convertEndpointsToCustomTypes(
                endpoints,
                extraTypes,
            )
            this.customApiGenerator.setCustomTypes(customTypes)
        }

        // Header comments
        sf.addStatements([
            '// Auto-generated Strapi API client',
            '// Do not edit manually',
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

        // Auth types
        sf.addStatements(this.authApiGenerator.generateAuthTypes())

        // CollectionAPI class (static block)
        sf.addStatements(this.generateCollectionAPI())

        // SingleTypeAPI class (static block)
        sf.addStatements(this.generateSingleTypeAPI())

        // Custom API classes (for collections with custom routes)
        if (parsedRoutes) {
            sf.addStatements(
                this.generateCustomAPIClasses(schema, parsedRoutes),
            )
        }

        // AuthAPI class (with dynamic methods if auth/user routes found)
        const authRoutes = parsedRoutes?.byController.get('auth') || []
        const userRoutes = parsedRoutes?.byController.get('user') || []
        sf.addStatements(
            this.authApiGenerator.generateAuthApiClass(authRoutes, userRoutes),
        )

        // Main StrapiClient class
        sf.addStatements(this.generateStrapiClient(schema, parsedRoutes))

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

        // StrapiError class
        this.addStrapiErrorClass(sf)

        // StrapiConnectionError class
        this.addStrapiConnectionErrorClass(sf)

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
            ],
        })

        // NextOptions interface
        sf.addInterface({
            name: 'NextOptions',
            isExported: true,
            properties: [
                {
                    name: 'revalidate',
                    type: 'number | false',
                    hasQuestionToken: true,
                },
                {
                    name: 'tags',
                    type: 'string[]',
                    hasQuestionToken: true,
                },
                {
                    name: 'cache',
                    type: 'RequestCache',
                    hasQuestionToken: true,
                },
                {
                    name: 'headers',
                    type: 'Record<string, string | undefined>',
                    hasQuestionToken: true,
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

    private addStrapiErrorClass(sf: SourceFile): void {
        sf.addClass({
            name: 'StrapiError',
            isExported: true,
            docs: ['Custom error class for Strapi API errors'],
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
                    name: 'details',
                    type: 'any',
                    hasQuestionToken: true,
                    docs: ['Additional error details from Strapi'],
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
                            type: 'any',
                            hasQuestionToken: true,
                        },
                    ],
                    statements: [
                        'super(message)',
                        'this.name = "StrapiError"',
                        'this.userMessage = userMessage',
                        'this.status = status',
                        'this.statusText = statusText',
                        'this.details = details',
                    ],
                },
            ],
        })
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
                {
                    name: 'cause',
                    type: 'Error',
                    hasQuestionToken: true,
                    docs: [
                        'The original error that caused the connection failure',
                    ],
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
    }

    private generateBaseAPIClass(): string {
        return `// Base API class with shared logic
class BaseAPI {
  constructor(protected config: StrapiClientConfig) {}

  private getErrorHint(status: number): string {
    switch (status) {
      case 401: return ' Hint: check that your API token is valid and passed to StrapiClient config.'
      case 403: return ' Hint: your token may lack permissions for this endpoint. Check Strapi roles & permissions.'
      case 404: return ' Hint: this endpoint may not exist. Verify the content type is created in Strapi and the API is enabled.'
      case 500: return ' Hint: internal Strapi error. Check Strapi server logs for details.'
      default: return ''
    }
  }

  protected async request<R>(
    url: string,
    options: RequestInit = {},
    nextOptions?: NextOptions,
    errorPrefix = 'Strapi API'
  ): Promise<R> {
    const fetchFn = this.config.fetch || globalThis.fetch

    if (this.config.debug) {
      console.log(\`[\${errorPrefix}] \${options.method || 'GET'} \${url}\`)
    }

    const headers: Record<string, string> = {
      ...options.headers as Record<string, string>,
    }

    // Only add Content-Type for JSON, let browser set it for FormData
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }

    if (this.config.token) {
      headers['Authorization'] = \`Bearer \${this.config.token}\`
    }

    // Merge custom headers from nextOptions
    if (nextOptions?.headers) {
      for (const [key, value] of Object.entries(nextOptions.headers)) {
        if (value !== undefined) {
          headers[key] = value
        }
      }
    }

    const fetchOptions: RequestInit = {
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
        } as any
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

    let response: Response
    try {
      response = await fetchFn(url, fetchOptions)
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId)

      const baseURL = this.config.baseURL
      const msg = error?.message || String(error)

      // Timeout (AbortController abort)
      if (error?.name === 'AbortError') {
        throw new StrapiConnectionError(
          \`Request timed out after \${this.config.timeout}ms. URL: \${url}\`,
          url,
          error
        )
      }

      // Connection refused
      if (msg.includes('ECONNREFUSED')) {
        throw new StrapiConnectionError(
          \`Could not connect to Strapi at \${baseURL}. Is the server running?\`,
          url,
          error
        )
      }

      // DNS resolution failure
      if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
        throw new StrapiConnectionError(
          \`Could not resolve host. Check your baseURL: \${baseURL}\`,
          url,
          error
        )
      }

      // Generic network error
      throw new StrapiConnectionError(
        \`Network error: \${msg}. Check your baseURL: \${baseURL}\`,
        url,
        error
      )
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }

    if (!response.ok) {
      // Detect HTML response (wrong server / reverse proxy error page)
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('text/html')) {
        throw new StrapiError(
          \`Strapi returned HTML instead of JSON. Your baseURL may point to the wrong server. URL: \${url}\`,
          'Unexpected HTML response from server',
          response.status,
          response.statusText
        )
      }

      const errorData = await response.json().catch(() => ({}))
      const userMessage = errorData.error?.message || response.statusText
      const hint = this.getErrorHint(response.status)
      const technicalMessage = \`\${errorPrefix} error: \${response.status} \${response.statusText}\${errorData.error?.message ? ' - ' + errorData.error.message : ''}\${hint}\`
      throw new StrapiError(
        technicalMessage,
        userMessage,
        response.status,
        response.statusText,
        errorData.error?.details
      )
    }

    // Handle 204 No Content (e.g., from DELETE operations)
    if (response.status === 204) {
      return null as R
    }

    return response.json()
  }

  protected buildQueryString(params?: QueryParams): string {
    if (!params) return ''

    const queryString = qs.stringify(params, {
      encodeValuesOnly: true,
      skipNulls: true,
    })

    return queryString ? \`?\${queryString}\` : ''
  }
}`
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
  ): Promise<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields> | null>
  // Overload: with populate '*' or true → all fields populated
  findOne<const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    documentId: string,
    params: { populate: '*' | true } & QueryParams<TBase, TFilters, '*' | true, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<TBase, '*'>, TBase, TFields> | null>
  // Overload: with populate array → populated return type
  findOne<const TPopulate extends readonly (keyof TPopulateKeys & string)[], const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(
    documentId: string,
    params: { populate: TPopulate } & QueryParams<TBase, TFilters, TPopulate, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields> | null>
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
        const classes: string[] = []

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

            if (contentType) {
                const className = `${contentType.cleanName}API`
                const baseClass =
                    contentType.kind === 'single'
                        ? 'SingleTypeAPI'
                        : 'CollectionAPI'
                const typeParams = this.buildTypeParams(contentType)
                const customMethods =
                    this.customApiGenerator.generateCustomMethods(
                        controller,
                        routes,
                        false,
                    )

                classes.push(
                    `// Custom API class for ${contentType.cleanName} (${contentType.kind} type) with custom routes
class ${className} extends ${baseClass}${typeParams} {
${customMethods}
}`,
                )
            } else {
                // Standalone API class (no content type)
                const className = toPascalCase(controller) + 'API'
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

        if (hasPopulatableFields) {
            return `<${contentType.cleanName}, ${contentType.cleanName}Input, ${contentType.cleanName}Filters, ${contentType.cleanName}PopulateParam>`
        }
        return `<${contentType.cleanName}, ${contentType.cleanName}Input, ${contentType.cleanName}Filters>`
    }

    private generateStrapiClient(
        schema: ParsedSchema,
        parsedRoutes?: ParsedRoutes,
    ): string {
        // Build property declarations
        const propertyDeclarations = schema.contentTypes
            .map(contentType => {
                const endpoint = this.transformer.toEndpointName(
                    contentType.cleanName,
                    contentType.kind === 'single',
                )
                const controllerName = endpoint.replace(/s$/, '')
                const hasCustomRoutes =
                    parsedRoutes?.byController.has(controllerName) &&
                    controllerName !== 'auth' &&
                    controllerName !== 'user'
                const apiClass = hasCustomRoutes
                    ? `${contentType.cleanName}API`
                    : contentType.kind === 'single'
                      ? 'SingleTypeAPI'
                      : 'CollectionAPI'
                const propName = toCamelCase(endpoint)
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
                const endpoint = this.transformer.toEndpointName(
                    contentType.cleanName,
                    contentType.kind === 'single',
                )
                const controllerName = endpoint.replace(/s$/, '')
                const hasCustomRoutes =
                    parsedRoutes?.byController.has(controllerName) &&
                    controllerName !== 'auth' &&
                    controllerName !== 'user'
                const apiClass = hasCustomRoutes
                    ? `${contentType.cleanName}API`
                    : contentType.kind === 'single'
                      ? 'SingleTypeAPI'
                      : 'CollectionAPI'
                const propName = toCamelCase(endpoint)

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

        return `// Main Strapi client
export class StrapiClient {
  private config: StrapiClientConfig

  // Auth API for users-permissions plugin
  authentication: AuthAPI

${propertyDeclarations}
${standaloneDeclarations}
  constructor(config: StrapiClientConfig) {
    this.config = config

    // Initialize Auth API
    this.authentication = new AuthAPI(this.config)

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
      const { SCHEMA_HASH } = await import("./schema-meta.js")
      const response = await fetch(\`\${this.config.baseURL}/api/strapi-types/schema-hash\`)
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

    private buildStandaloneDeclarations(
        schema: ParsedSchema,
        parsedRoutes?: ParsedRoutes,
    ): string {
        if (!parsedRoutes) return ''

        const declarations: string[] = []
        for (const [controller] of parsedRoutes.byController) {
            if (controller === 'auth' || controller === 'user') continue

            const hasContentType = schema.contentTypes.some(
                ct =>
                    this.transformer
                        .toEndpointName(ct.cleanName, false)
                        .replace(/s$/, '') === controller,
            )

            if (!hasContentType) {
                const className = toPascalCase(controller) + 'API'
                const propName = toCamelCase(controller)
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
        for (const [controller] of parsedRoutes.byController) {
            if (controller === 'auth' || controller === 'user') continue

            const hasContentType = schema.contentTypes.some(
                ct =>
                    this.transformer
                        .toEndpointName(ct.cleanName, false)
                        .replace(/s$/, '') === controller,
            )

            if (!hasContentType) {
                const className = toPascalCase(controller) + 'API'
                const propName = toCamelCase(controller)
                inits.push(
                    `    this.${propName} = new ${className}(this.config)`,
                )
            }
        }

        return inits.join('\n')
    }
}
