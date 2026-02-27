import { Project } from 'ts-morph'
import { ParsedRoute } from '../shared/route-types.js'
import { toCamelCase } from '../shared/index.js'

export class AuthApiGenerator {
    generateAuthTypes(): string {
        const project = new Project({ useInMemoryFileSystem: true })
        const sf = project.createSourceFile('auth-types.ts')

        sf.addStatements('// Auth API types for users-permissions plugin')

        sf.addInterface({
            name: 'LoginCredentials',
            isExported: true,
            properties: [
                { name: 'identifier', type: 'string' },
                { name: 'password', type: 'string' },
            ],
        })

        sf.addInterface({
            name: 'RegisterData',
            isExported: true,
            properties: [
                { name: 'username', type: 'string' },
                { name: 'email', type: 'string' },
                { name: 'password', type: 'string' },
                {
                    name: 'referralCode',
                    type: 'string',
                    hasQuestionToken: true,
                },
                {
                    name: 'referralSource',
                    type: '"code" | "link" | "share"',
                    hasQuestionToken: true,
                },
            ],
        })

        sf.addInterface({
            name: 'AuthResponse',
            isExported: true,
            properties: [
                { name: 'jwt', type: 'string' },
                { name: 'user', type: 'User' },
            ],
        })

        sf.addInterface({
            name: 'ForgotPasswordData',
            isExported: true,
            properties: [{ name: 'email', type: 'string' }],
        })

        sf.addInterface({
            name: 'ResetPasswordData',
            isExported: true,
            properties: [
                { name: 'code', type: 'string' },
                { name: 'password', type: 'string' },
                { name: 'passwordConfirmation', type: 'string' },
            ],
        })

        sf.addInterface({
            name: 'ChangePasswordData',
            isExported: true,
            properties: [
                { name: 'currentPassword', type: 'string' },
                { name: 'password', type: 'string' },
                { name: 'passwordConfirmation', type: 'string' },
            ],
        })

        sf.addInterface({
            name: 'EmailConfirmationResponse',
            isExported: true,
            properties: [
                { name: 'jwt', type: 'string' },
                { name: 'user', type: 'User' },
            ],
        })

        return sf.getFullText()
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
        // Generate methods for auth routes
        const authMethods = authRoutes
            .map(route => this.generateDynamicAuthMethod(route))
            .join('\n\n')

        // Generate methods for user routes - but only special ones (me, updateMe, count)
        const specialUserRoutes = userRoutes.filter(
            r =>
                r.action === 'me' ||
                r.action === 'updateMe' ||
                r.action === 'count',
        )
        const userMethods = specialUserRoutes
            .map(route => this.generateDynamicAuthMethod(route))
            .join('\n\n')

        return `// Auth API wrapper for users-permissions plugin (generated from actual routes)
class AuthAPI extends BaseAPI {
  constructor(config: StrapiClientConfig) {
    super(config)
  }

${authMethods}

${userMethods}
}`
    }

    private generateDynamicAuthMethod(route: ParsedRoute): string {
        // Generate method name from action, with special handling for callback
        let methodName = toCamelCase(route.action)

        // Special case: rename auth.callback on /auth/local to "login"
        if (
            route.action === 'callback' &&
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
        const returnType = this.getReturnType(route)
        const params = this.generateAuthMethodParams(route)
        const pathExpression = this.generateAuthPathExpression(route)
        const hasBody =
            route.method === 'POST' ||
            route.method === 'PUT' ||
            route.method === 'PATCH'

        const bodyBlock = hasBody
            ? `    return this.request<${returnType}>(
      url,
      {
        method: '${route.method}',
        body: ${route.params.length > 0 ? 'JSON.stringify(data)' : 'data ? JSON.stringify(data) : undefined'},
      },
      nextOptions,
      'Strapi Auth'
    )`
            : `    return this.request<${returnType}>(
      url,
      ${route.method !== 'GET' ? `{ method: '${route.method}' }` : '{}'},
      nextOptions,
      'Strapi Auth'
    )`

        return `  /**
   * ${route.method} ${route.path}
   * Handler: ${route.handler}
   */
  async ${methodName}(${params}): Promise<${returnType}> {
    const url = \`\${this.config.baseURL}${pathExpression.slice(1, -1)}\`
${bodyBlock}
  }`
    }

    private getReturnType(route: ParsedRoute): string {
        if (
            route.action === 'callback' ||
            route.action === 'register' ||
            route.action === 'resetPassword' ||
            route.action === 'changePassword'
        ) {
            return 'AuthResponse'
        } else if (route.action === 'findOne') {
            return 'User'
        } else if (route.action === 'find') {
            return 'User[]'
        } else if (
            route.action === 'forgotPassword' ||
            route.action === 'sendEmailConfirmation'
        ) {
            return '{ ok: boolean }'
        } else if (route.action === 'emailConfirmation') {
            return 'EmailConfirmationResponse'
        }
        return 'any'
    }

    private generateMeMethod(route: ParsedRoute): string {
        return `  /**
   * ${route.method} ${route.path}
   * Handler: ${route.handler}
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
  }`
    }

    private generateUpdateMeMethod(route: ParsedRoute): string {
        return `  /**
   * ${route.method} ${route.path}
   * Handler: ${route.handler}
   * Safe way to update current user without knowing their ID
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
  }`
    }

    private generateCallbackMethod(route: ParsedRoute): string {
        return `  /**
   * ${route.method} ${route.path}
   * Handler: ${route.handler}
   * OAuth callback with query string support
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
  }`
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
            if (route.action === 'callback' && route.path === '/auth/local') {
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

        // Add NextOptions parameter
        params.push('nextOptions?: NextOptions')

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
