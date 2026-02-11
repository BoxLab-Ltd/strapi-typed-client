import { ParsedRoute } from '../parser/routes-parser.js'
import { toCamelCase } from '../shared/index.js'

export class AuthApiGenerator {
    generateAuthTypes(): string {
        const lines: string[] = []

        lines.push('// Auth API types for users-permissions plugin')
        lines.push('')
        lines.push('export interface LoginCredentials {')
        lines.push('  identifier: string')
        lines.push('  password: string')
        lines.push('}')
        lines.push('')
        lines.push('export interface RegisterData {')
        lines.push('  username: string')
        lines.push('  email: string')
        lines.push('  password: string')
        lines.push('  referralCode?: string')
        lines.push('  referralSource?: "code" | "link" | "share"')
        lines.push('}')
        lines.push('')
        lines.push('export interface AuthResponse {')
        lines.push('  jwt: string')
        lines.push('  user: User')
        lines.push('}')
        lines.push('')
        lines.push('export interface ForgotPasswordData {')
        lines.push('  email: string')
        lines.push('}')
        lines.push('')
        lines.push('export interface ResetPasswordData {')
        lines.push('  code: string')
        lines.push('  password: string')
        lines.push('  passwordConfirmation: string')
        lines.push('}')
        lines.push('')
        lines.push('export interface ChangePasswordData {')
        lines.push('  currentPassword: string')
        lines.push('  password: string')
        lines.push('  passwordConfirmation: string')
        lines.push('}')
        lines.push('')
        lines.push('export interface EmailConfirmationResponse {')
        lines.push('  jwt: string')
        lines.push('  user: User')
        lines.push('}')

        return lines.join('\n')
    }

    generateAuthApiClass(
        authRoutes: ParsedRoute[] = [],
        userRoutes: ParsedRoute[] = [],
    ): string {
        const allAuthRoutes = [...authRoutes, ...userRoutes]

        // If no routes provided, use hardcoded version
        if (allAuthRoutes.length === 0) {
            return this.generateHardcodedAuthApiClass()
        }

        // Generate dynamic AuthAPI based on actual routes
        return this.generateDynamicAuthApiClass(authRoutes, userRoutes)
    }

    private generateHardcodedAuthApiClass(): string {
        return `// Auth API wrapper for users-permissions plugin
class AuthAPI extends BaseAPI {
  constructor(config: StrapiClientConfig) {
    super(config)
  }

  /**
   * Login with email/username and password
   * POST /api/auth/local
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const url = \`\${this.config.baseURL}/api/auth/local\`
    return this.request<AuthResponse>(url, {
      method: 'POST',
      body: JSON.stringify(credentials),
    }, undefined, 'Strapi Auth')
  }

  /**
   * Register a new user
   * POST /api/auth/local/register
   */
  async register(data: RegisterData): Promise<AuthResponse> {
    const url = \`\${this.config.baseURL}/api/auth/local/register\`
    return this.request<AuthResponse>(url, {
      method: 'POST',
      body: JSON.stringify(data),
    }, undefined, 'Strapi Auth')
  }

  /**
   * Get current authenticated user
   * GET /api/users/me
   * Supports populate with automatic type inference
   */

  // Overload: with populate object → populated return type
  me<const TPopulate extends UserPopulateParam, const TFields extends Exclude<keyof User & string, '__typename'> = never>(
    params: { populate: TPopulate } & QueryParams<User, UserFilters, TPopulate, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<User, TPopulate>, User, TFields>>
  // Overload: with populate '*' or true → all fields populated
  me<const TFields extends Exclude<keyof User & string, '__typename'> = never>(
    params: { populate: '*' | true } & QueryParams<User, UserFilters, '*' | true, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<User, '*'>, User, TFields>>
  // Overload: general case → base return type
  me<const TFields extends Exclude<keyof User & string, '__typename'> = never>(
    params?: QueryParams<User, UserFilters, UserPopulateParam | (keyof UserPopulateParam & string)[] | '*' | boolean, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<User, User, TFields>>

  async me(params?: any, nextOptions?: any): Promise<any> {
    const queryString = params ? this.buildQueryString(params) : ''
    const url = queryString ? \`\${this.config.baseURL}/api/users/me\${queryString}\` : \`\${this.config.baseURL}/api/users/me\`
    const response = await this.request<any>(url, {}, nextOptions, "Strapi Auth")
    return response
  }

  /**
   * Update current authenticated user
   * PUT /api/users/me
   * Supports populate with automatic type inference
   */

  // Overload: with populate object → populated return type
  updateMe<const TPopulate extends UserPopulateParam, const TFields extends Exclude<keyof User & string, '__typename'> = never>(
    data: Partial<User>,
    params: { populate: TPopulate } & QueryParams<User, UserFilters, TPopulate, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<User, TPopulate>, User, TFields>>
  // Overload: with populate '*' or true → all fields populated
  updateMe<const TFields extends Exclude<keyof User & string, '__typename'> = never>(
    data: Partial<User>,
    params: { populate: '*' | true } & QueryParams<User, UserFilters, '*' | true, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<GetPopulated<User, '*'>, User, TFields>>
  // Overload: general case → base return type
  updateMe<const TFields extends Exclude<keyof User & string, '__typename'> = never>(
    data: Partial<User>,
    params?: QueryParams<User, UserFilters, UserPopulateParam | (keyof UserPopulateParam & string)[] | '*' | boolean, TFields>,
    nextOptions?: NextOptions
  ): Promise<SelectFields<User, User, TFields>>

  async updateMe(data: Partial<User>, params?: any, nextOptions?: any): Promise<any> {
    const queryString = params ? this.buildQueryString(params) : ''
    const url = queryString ? \`\${this.config.baseURL}/api/users/me\${queryString}\` : \`\${this.config.baseURL}/api/users/me\`
    const response = await this.request<any>(
      url,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      },
      nextOptions,
      "Strapi Auth"
    )
    return response
  }

  /**
   * OAuth callback
   * GET /api/auth/:provider/callback
   * @param provider - OAuth provider name (google, github, etc.)
   * @param search - Query string (e.g., "access_token=xxx&code=yyy" or "?access_token=xxx")
   */
  async callback(
    provider: string,
    search?: string,
    nextOptions?: NextOptions
  ): Promise<AuthResponse> {
    let path = \`/api/auth/\${provider}/callback\`
    if (search) {
      // Add search string, handling both "?key=val" and "key=val" formats
      path += search.startsWith("?") ? search : \`?\${search}\`
    }
    const url = \`\${this.config.baseURL}\${path}\`
    return this.request<AuthResponse>(url, {}, nextOptions, "Strapi Auth")
  }

  /**
   * Logout current user (client-side token removal helper)
   */
  async logout(): Promise<void> {
    this.config.token = undefined
  }

  /**
   * Request password reset email
   * POST /api/auth/forgot-password
   */
  async forgotPassword(data: ForgotPasswordData): Promise<{ ok: boolean }> {
    const url = \`\${this.config.baseURL}/api/auth/forgot-password\`
    await this.request(url, {
      method: 'POST',
      body: JSON.stringify(data),
    }, undefined, 'Strapi Auth')
    return { ok: true }
  }

  /**
   * Reset password using reset code
   * POST /api/auth/reset-password
   */
  async resetPassword(data: ResetPasswordData): Promise<AuthResponse> {
    const url = \`\${this.config.baseURL}/api/auth/reset-password\`
    return this.request<AuthResponse>(url, {
      method: 'POST',
      body: JSON.stringify(data),
    }, undefined, 'Strapi Auth')
  }

  /**
   * Change password for authenticated user
   * POST /api/auth/change-password
   */
  async changePassword(data: ChangePasswordData): Promise<AuthResponse> {
    const url = \`\${this.config.baseURL}/api/auth/change-password\`
    return this.request<AuthResponse>(url, {
      method: 'POST',
      body: JSON.stringify(data),
    }, undefined, 'Strapi Auth')
  }

  /**
   * Confirm user email address
   * GET /api/auth/email-confirmation?confirmation=TOKEN
   */
  async confirmEmail(confirmationToken: string, nextOptions?: NextOptions): Promise<EmailConfirmationResponse> {
    const url = \`\${this.config.baseURL}/api/auth/email-confirmation?confirmation=\${confirmationToken}\`
    return this.request<EmailConfirmationResponse>(
      url,
      {},
      nextOptions,
      'Strapi Auth'
    )
  }

  /**
   * Send email confirmation
   * POST /api/auth/send-email-confirmation
   */
  async sendEmailConfirmation(email: string): Promise<{ ok: boolean }> {
    const url = \`\${this.config.baseURL}/api/auth/send-email-confirmation\`
    await this.request(url, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }, undefined, 'Strapi Auth')
    return { ok: true }
  }
}`
    }

    private generateDynamicAuthApiClass(
        authRoutes: ParsedRoute[],
        userRoutes: ParsedRoute[],
    ): string {
        const lines: string[] = []

        lines.push(
            '// Auth API wrapper for users-permissions plugin (generated from actual routes)',
        )
        lines.push('class AuthAPI extends BaseAPI {')
        lines.push('  constructor(config: StrapiClientConfig) {')
        lines.push('    super(config)')
        lines.push('  }')
        lines.push('')

        // Generate methods for auth routes
        for (const route of authRoutes) {
            lines.push(this.generateDynamicAuthMethod(route))
            lines.push('')
        }

        // Generate methods for user routes - but only special ones (me, updateMe, count)
        // Other user routes (find, findOne, create, update, delete) should be handled by users: CollectionAPI<User>
        const specialUserRoutes = userRoutes.filter(
            r =>
                r.action === 'me' ||
                r.action === 'updateMe' ||
                r.action === 'count',
        )

        for (const route of specialUserRoutes) {
            lines.push(this.generateDynamicAuthMethod(route))
            lines.push('')
        }

        lines.push('}')

        return lines.join('\n')
    }

    private generateDynamicAuthMethod(route: ParsedRoute): string {
        const lines: string[] = []

        // Generate method name from action, with special handling for callback
        let methodName = toCamelCase(route.action)

        // Special case: rename auth.callback on /auth/local to "login"
        if (
            route.handler === 'auth.callback' &&
            route.path === '/auth/local' &&
            route.method === 'POST'
        ) {
            methodName = 'login'
        }

        // Special handling for me() - it should support populate with type inference
        if (route.action === 'me') {
            return this.generateMeMethod(route)
        }

        // Special handling for updateMe() - safe way to update current user
        if (route.action === 'updateMe') {
            return this.generateUpdateMeMethod(route)
        }

        // Special handling for OAuth callback() - needs query params support
        if (
            route.action === 'callback' &&
            route.method === 'GET' &&
            route.path.includes(':provider')
        ) {
            return this.generateCallbackMethod(route)
        }

        // Determine return type based on route path/action
        let returnType = 'any'
        if (
            route.action === 'callback' ||
            route.action === 'register' ||
            route.action === 'resetPassword' ||
            route.action === 'changePassword'
        ) {
            returnType = 'AuthResponse'
        } else if (route.action === 'findOne') {
            returnType = 'User'
        } else if (route.action === 'find') {
            returnType = 'User[]'
        } else if (
            route.action === 'forgotPassword' ||
            route.action === 'sendEmailConfirmation'
        ) {
            returnType = '{ ok: boolean }'
        } else if (route.action === 'emailConfirmation') {
            returnType = 'EmailConfirmationResponse'
        }

        // Generate JSDoc comment
        lines.push('  /**')
        lines.push(`   * ${route.method} ${route.path}`)
        lines.push(`   * Handler: ${route.handler}`)
        lines.push('   */')

        // Generate method signature
        const params = this.generateAuthMethodParams(route)
        lines.push(`  async ${methodName}(${params}): Promise<${returnType}> {`)

        // Generate method body
        const pathExpression = this.generateAuthPathExpression(route)
        const hasBody =
            route.method === 'POST' ||
            route.method === 'PUT' ||
            route.method === 'PATCH'

        lines.push(
            `    const url = \`\${this.config.baseURL}${pathExpression.slice(1, -1)}\``,
        )

        if (hasBody) {
            lines.push(`    return this.request<${returnType}>(`)
            lines.push(`      url,`)
            lines.push(`      {`)
            lines.push(`        method: '${route.method}',`)
            if (route.params.length > 0) {
                lines.push(`        body: JSON.stringify(data),`)
            } else {
                lines.push(
                    `        body: data ? JSON.stringify(data) : undefined,`,
                )
            }
            lines.push(`      },`)
            lines.push(`      nextOptions,`)
            lines.push(`      'Strapi Auth'`)
            lines.push(`    )`)
        } else {
            // For GET requests, use empty object (GET is default)
            // For DELETE and other methods, specify the method explicitly
            const needsMethod = route.method !== 'GET'
            lines.push(`    return this.request<${returnType}>(`)
            lines.push(`      url,`)
            if (needsMethod) {
                lines.push(`      { method: '${route.method}' },`)
            } else {
                lines.push(`      {},`)
            }
            lines.push(`      nextOptions,`)
            lines.push(`      'Strapi Auth'`)
            lines.push(`    )`)
        }

        lines.push('  }')

        return lines.join('\n')
    }

    private generateMeMethod(route: ParsedRoute): string {
        const lines: string[] = []

        lines.push('  /**')
        lines.push(`   * ${route.method} ${route.path}`)
        lines.push(`   * Handler: ${route.handler}`)
        lines.push(`   * Supports populate with automatic type inference`)
        lines.push('   */')
        lines.push('')

        // Overloads for type-safe populate
        lines.push(
            '  // Overload: with populate object → populated return type',
        )
        lines.push(
            "  me<const TPopulate extends UserPopulateParam, const TFields extends Exclude<keyof User & string, '__typename'> = never>(",
        )
        lines.push(
            '    params: { populate: TPopulate } & QueryParams<User, UserFilters, TPopulate, TFields>,',
        )
        lines.push('    nextOptions?: NextOptions')
        lines.push(
            '  ): Promise<SelectFields<GetPopulated<User, TPopulate>, User, TFields>>',
        )
        lines.push(
            "  // Overload: with populate '*' or true → all fields populated",
        )
        lines.push(
            "  me<const TFields extends Exclude<keyof User & string, '__typename'> = never>(",
        )
        lines.push(
            "    params: { populate: '*' | true } & QueryParams<User, UserFilters, '*' | true, TFields>,",
        )
        lines.push('    nextOptions?: NextOptions')
        lines.push(
            "  ): Promise<SelectFields<GetPopulated<User, '*'>, User, TFields>>",
        )
        lines.push('  // Overload: general case → base return type')
        lines.push(
            "  me<const TFields extends Exclude<keyof User & string, '__typename'> = never>(",
        )
        lines.push(
            "    params?: QueryParams<User, UserFilters, UserPopulateParam | (keyof UserPopulateParam & string)[] | '*' | boolean, TFields>,",
        )
        lines.push('    nextOptions?: NextOptions')
        lines.push('  ): Promise<SelectFields<User, User, TFields>>')
        lines.push('')

        // Implementation
        lines.push(
            '  async me(params?: any, nextOptions?: any): Promise<any> {',
        )
        lines.push(
            "    const queryString = params ? this.buildQueryString(params) : ''",
        )
        lines.push(
            '    const url = queryString ? `${this.config.baseURL}/api/users/me${queryString}` : `${this.config.baseURL}/api/users/me`',
        )
        lines.push(
            '    const response = await this.request<any>(url, {}, nextOptions, "Strapi Auth")',
        )
        lines.push('    return response')
        lines.push('  }')

        return lines.join('\n')
    }

    private generateUpdateMeMethod(route: ParsedRoute): string {
        const lines: string[] = []

        lines.push('  /**')
        lines.push(`   * ${route.method} ${route.path}`)
        lines.push(`   * Handler: ${route.handler}`)
        lines.push(
            `   * Safe way to update current user without knowing their ID`,
        )
        lines.push(`   * Supports populate with automatic type inference`)
        lines.push('   */')
        lines.push('')

        // Overloads for type-safe populate
        lines.push(
            '  // Overload: with populate object → populated return type',
        )
        lines.push(
            "  updateMe<const TPopulate extends UserPopulateParam, const TFields extends Exclude<keyof User & string, '__typename'> = never>(",
        )
        lines.push('    data: Partial<User>,')
        lines.push(
            '    params: { populate: TPopulate } & QueryParams<User, UserFilters, TPopulate, TFields>,',
        )
        lines.push('    nextOptions?: NextOptions')
        lines.push(
            '  ): Promise<SelectFields<GetPopulated<User, TPopulate>, User, TFields>>',
        )
        lines.push(
            "  // Overload: with populate '*' or true → all fields populated",
        )
        lines.push(
            "  updateMe<const TFields extends Exclude<keyof User & string, '__typename'> = never>(",
        )
        lines.push('    data: Partial<User>,')
        lines.push(
            "    params: { populate: '*' | true } & QueryParams<User, UserFilters, '*' | true, TFields>,",
        )
        lines.push('    nextOptions?: NextOptions')
        lines.push(
            "  ): Promise<SelectFields<GetPopulated<User, '*'>, User, TFields>>",
        )
        lines.push('  // Overload: general case → base return type')
        lines.push(
            "  updateMe<const TFields extends Exclude<keyof User & string, '__typename'> = never>(",
        )
        lines.push('    data: Partial<User>,')
        lines.push(
            "    params?: QueryParams<User, UserFilters, UserPopulateParam | (keyof UserPopulateParam & string)[] | '*' | boolean, TFields>,",
        )
        lines.push('    nextOptions?: NextOptions')
        lines.push('  ): Promise<SelectFields<User, User, TFields>>')
        lines.push('')

        // Implementation
        lines.push(
            '  async updateMe(data: Partial<User>, params?: any, nextOptions?: any): Promise<any> {',
        )
        lines.push(
            "    const queryString = params ? this.buildQueryString(params) : ''",
        )
        lines.push(
            '    const url = queryString ? `${this.config.baseURL}/api/users/me${queryString}` : `${this.config.baseURL}/api/users/me`',
        )
        lines.push('    const response = await this.request<any>(')
        lines.push('      url,')
        lines.push('      {')
        lines.push("        method: 'PUT',")
        lines.push('        body: JSON.stringify(data),')
        lines.push('      },')
        lines.push('      nextOptions,')
        lines.push('      "Strapi Auth"')
        lines.push('    )')
        lines.push('    return response')
        lines.push('  }')

        return lines.join('\n')
    }

    private generateCallbackMethod(route: ParsedRoute): string {
        const lines: string[] = []

        lines.push('  /**')
        lines.push(`   * ${route.method} ${route.path}`)
        lines.push(`   * Handler: ${route.handler}`)
        lines.push('   * OAuth callback with query string support')
        lines.push(
            '   * @param provider - OAuth provider name (google, github, etc.)',
        )
        lines.push(
            '   * @param search - Query string (e.g., "access_token=xxx&code=yyy" or "?access_token=xxx")',
        )
        lines.push('   */')
        lines.push('  async callback(')
        lines.push('    provider: string,')
        lines.push('    search?: string,')
        lines.push('    nextOptions?: NextOptions')
        lines.push('  ): Promise<AuthResponse> {')
        lines.push('    let path = `/api/auth/$' + '{provider}/callback`')
        lines.push('    if (search) {')
        lines.push(
            '      // Add search string, handling both "?key=val" and "key=val" formats',
        )
        lines.push(
            '      path += search.startsWith("?") ? search : `?$' + '{search}`',
        )
        lines.push('    }')
        lines.push('    const url = `${this.config.baseURL}${path}`')
        lines.push(
            '    return this.request<AuthResponse>(url, {}, nextOptions, "Strapi Auth")',
        )
        lines.push('  }')

        return lines.join('\n')
    }

    private generateAuthMethodParams(route: ParsedRoute): string {
        const params: string[] = []

        // Add path parameters
        for (const param of route.params) {
            params.push(`${param}: string`)
        }

        // Add data parameter for POST/PUT/PATCH
        if (
            route.method === 'POST' ||
            route.method === 'PUT' ||
            route.method === 'PATCH'
        ) {
            // Infer data type based on action
            if (
                route.handler === 'auth.callback' &&
                route.path === '/auth/local'
            ) {
                params.push('data: LoginCredentials')
            } else if (route.action === 'register') {
                params.push('data: RegisterData')
            } else if (route.action === 'forgotPassword') {
                params.push('data: ForgotPasswordData')
            } else if (route.action === 'resetPassword') {
                params.push('data: ResetPasswordData')
            } else if (route.action === 'changePassword') {
                params.push('data: ChangePasswordData')
            } else {
                params.push('data?: any')
            }
        }

        // Add NextOptions parameter for GET requests or as last parameter
        if (route.method === 'GET' || params.length === 0) {
            params.push('nextOptions?: NextOptions')
        } else {
            params.push('nextOptions?: NextOptions')
        }

        return params.join(', ')
    }

    private generateAuthPathExpression(route: ParsedRoute): string {
        let pathTemplate = route.path

        // Convert :param to ${param}
        pathTemplate = pathTemplate.replace(
            /:([a-zA-Z_][a-zA-Z0-9_]*)/g,
            '${$1}',
        )

        return '`/api' + pathTemplate + '`'
    }
}
