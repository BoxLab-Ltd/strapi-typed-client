import { describe, it, expect } from 'vitest'
import { AuthApiGenerator } from '../../../src/generator/auth-api-generator.js'
import type { ParsedRoute } from '../../../src/parser/routes-parser.js'

const generator = new AuthApiGenerator()

describe('generateAuthTypes', () => {
    const result = generator.generateAuthTypes()

    it('should generate LoginCredentials interface', () => {
        expect(result).toContain('export interface LoginCredentials {')
        expect(result).toContain('  identifier: string')
        expect(result).toContain('  password: string')
    })

    it('should generate RegisterData interface with referralCode and referralSource', () => {
        expect(result).toContain('export interface RegisterData {')
        expect(result).toContain('  username: string')
        expect(result).toContain('  email: string')
        expect(result).toContain('  password: string')
        expect(result).toContain('  referralCode?: string')
        expect(result).toContain('  referralSource?: "code" | "link" | "share"')
    })

    it('should generate AuthResponse interface with jwt and user', () => {
        expect(result).toContain('export interface AuthResponse {')
        expect(result).toContain('  jwt: string')
        expect(result).toContain('  user: User')
    })

    it('should generate ForgotPasswordData interface', () => {
        expect(result).toContain('export interface ForgotPasswordData {')
        expect(result).toContain('  email: string')
    })

    it('should generate ResetPasswordData interface', () => {
        expect(result).toContain('export interface ResetPasswordData {')
        expect(result).toContain('  code: string')
        expect(result).toContain('  password: string')
        expect(result).toContain('  passwordConfirmation: string')
    })

    it('should generate ChangePasswordData interface', () => {
        expect(result).toContain('export interface ChangePasswordData {')
        expect(result).toContain('  currentPassword: string')
        expect(result).toContain('  password: string')
        expect(result).toContain('  passwordConfirmation: string')
    })

    it('should generate EmailConfirmationResponse interface', () => {
        expect(result).toContain('export interface EmailConfirmationResponse {')
        expect(result).toContain('  jwt: string')
        expect(result).toContain('  user: User')
    })
})

describe('generateAuthApiClass - hardcoded (no routes)', () => {
    const result = generator.generateAuthApiClass()

    it('should generate AuthAPI class extending BaseAPI', () => {
        expect(result).toContain('class AuthAPI extends BaseAPI {')
        expect(result).toContain('constructor(config: StrapiClientConfig)')
        expect(result).toContain('super(config)')
    })

    it('should generate login method (POST /api/auth/local)', () => {
        expect(result).toContain(
            'async login(credentials: LoginCredentials): Promise<AuthResponse>',
        )
        expect(result).toContain('POST /api/auth/local')
        expect(result).toContain("method: 'POST'")
        expect(result).toContain('body: JSON.stringify(credentials)')
    })

    it('should generate register method (POST /api/auth/local/register)', () => {
        expect(result).toContain(
            'async register(data: RegisterData): Promise<AuthResponse>',
        )
        expect(result).toContain('POST /api/auth/local/register')
        expect(result).toContain('body: JSON.stringify(data)')
    })

    it('should generate me() with 3 overloads', () => {
        // Overload 1: TPopulate + TFields generics, SelectFields return
        expect(result).toContain(
            "me<const TPopulate extends UserPopulateParam, const TFields extends Exclude<keyof User & string, '__typename'> = never>(",
        )
        expect(result).toContain(
            '    params: { populate: TPopulate } & QueryParams<User, UserFilters, TPopulate, TFields>,',
        )
        expect(result).toContain(
            '  ): Promise<SelectFields<GetPopulated<User, TPopulate>, User, TFields>>',
        )

        // Overload 2: populate '*' | true, SelectFields return
        expect(result).toContain(
            "    params: { populate: '*' | true } & QueryParams<User, UserFilters, '*' | true, TFields>,",
        )
        expect(result).toContain(
            "  ): Promise<SelectFields<GetPopulated<User, '*'>, User, TFields>>",
        )

        // Overload 3: general case, SelectFields return
        expect(result).toContain(
            "    params?: QueryParams<User, UserFilters, UserPopulateParam | (keyof UserPopulateParam & string)[] | '*' | boolean, TFields>,",
        )
        expect(result).toContain(
            '  ): Promise<SelectFields<User, User, TFields>>',
        )

        // Implementation signature
        expect(result).toContain(
            'async me(params?: any, nextOptions?: any): Promise<any>',
        )
    })

    it('should generate updateMe() with 3 overloads', () => {
        // Overload 1: with data: Partial<User> and populate object
        expect(result).toContain(
            "updateMe<const TPopulate extends UserPopulateParam, const TFields extends Exclude<keyof User & string, '__typename'> = never>(",
        )
        expect(result).toContain('    data: Partial<User>,')
        expect(result).toContain(
            '    params: { populate: TPopulate } & QueryParams<User, UserFilters, TPopulate, TFields>,',
        )

        // Overload 2: with populate '*' or true
        expect(result).toContain(
            "  ): Promise<SelectFields<GetPopulated<User, '*'>, User, TFields>>",
        )

        // Overload 3: general case
        expect(result).toContain(
            "    params?: QueryParams<User, UserFilters, UserPopulateParam | (keyof UserPopulateParam & string)[] | '*' | boolean, TFields>,",
        )

        // Implementation signature
        expect(result).toContain(
            'async updateMe(data: Partial<User>, params?: any, nextOptions?: any): Promise<any>',
        )
        expect(result).toContain("method: 'PUT'")
        expect(result).toContain('body: JSON.stringify(data)')
    })

    it('should generate callback method with provider and search params', () => {
        expect(result).toContain('async callback(')
        expect(result).toContain('provider: string,')
        expect(result).toContain('search?: string,')
        expect(result).toContain('nextOptions?: NextOptions')
        expect(result).toContain('): Promise<AuthResponse>')
        expect(result).toContain('OAuth callback')
        expect(result).toContain('GET /api/auth/:provider/callback')
    })

    it('should generate logout method', () => {
        expect(result).toContain('async logout(): Promise<void>')
        expect(result).toContain('this.config.token = undefined')
    })

    it('should generate forgotPassword method', () => {
        expect(result).toContain(
            'async forgotPassword(data: ForgotPasswordData): Promise<{ ok: boolean }>',
        )
        expect(result).toContain('POST /api/auth/forgot-password')
        expect(result).toContain('body: JSON.stringify(data)')
    })

    it('should generate resetPassword method', () => {
        expect(result).toContain(
            'async resetPassword(data: ResetPasswordData): Promise<AuthResponse>',
        )
        expect(result).toContain('POST /api/auth/reset-password')
    })

    it('should generate changePassword method', () => {
        expect(result).toContain(
            'async changePassword(data: ChangePasswordData): Promise<AuthResponse>',
        )
        expect(result).toContain('POST /api/auth/change-password')
    })

    it('should generate confirmEmail method', () => {
        expect(result).toContain(
            'async confirmEmail(confirmationToken: string, nextOptions?: NextOptions): Promise<EmailConfirmationResponse>',
        )
        expect(result).toContain(
            'GET /api/auth/email-confirmation?confirmation=TOKEN',
        )
    })

    it('should generate sendEmailConfirmation method', () => {
        expect(result).toContain(
            'async sendEmailConfirmation(email: string): Promise<{ ok: boolean }>',
        )
        expect(result).toContain('POST /api/auth/send-email-confirmation')
        expect(result).toContain('body: JSON.stringify({ email })')
    })
})

describe('generateAuthApiClass - dynamic (with routes)', () => {
    const authRoutes: ParsedRoute[] = [
        {
            method: 'POST',
            path: '/auth/local',
            handler: 'auth.callback',
            controller: 'auth',
            action: 'callback',
            params: [],
        },
        {
            method: 'POST',
            path: '/auth/local/register',
            handler: 'auth.register',
            controller: 'auth',
            action: 'register',
            params: [],
        },
        {
            method: 'GET',
            path: '/auth/:provider/callback',
            handler: 'auth.callback',
            controller: 'auth',
            action: 'callback',
            params: ['provider'],
        },
        {
            method: 'POST',
            path: '/auth/forgot-password',
            handler: 'auth.forgotPassword',
            controller: 'auth',
            action: 'forgotPassword',
            params: [],
        },
        {
            method: 'POST',
            path: '/auth/reset-password',
            handler: 'auth.resetPassword',
            controller: 'auth',
            action: 'resetPassword',
            params: [],
        },
        {
            method: 'POST',
            path: '/auth/change-password',
            handler: 'auth.changePassword',
            controller: 'auth',
            action: 'changePassword',
            params: [],
        },
        {
            method: 'GET',
            path: '/auth/email-confirmation',
            handler: 'auth.emailConfirmation',
            controller: 'auth',
            action: 'emailConfirmation',
            params: [],
        },
        {
            method: 'POST',
            path: '/auth/send-email-confirmation',
            handler: 'auth.sendEmailConfirmation',
            controller: 'auth',
            action: 'sendEmailConfirmation',
            params: [],
        },
    ]

    const userRoutes: ParsedRoute[] = [
        {
            method: 'GET',
            path: '/users/me',
            handler: 'user.me',
            controller: 'user',
            action: 'me',
            params: [],
        },
        {
            method: 'PUT',
            path: '/users/me',
            handler: 'user.updateMe',
            controller: 'user',
            action: 'updateMe',
            params: [],
        },
        {
            method: 'GET',
            path: '/users/count',
            handler: 'user.count',
            controller: 'user',
            action: 'count',
            params: [],
        },
    ]

    const result = generator.generateAuthApiClass(authRoutes, userRoutes)

    it('should generate dynamic AuthAPI from actual routes', () => {
        expect(result).toContain('class AuthAPI extends BaseAPI {')
        expect(result).toContain('generated from actual routes')
        expect(result).toContain('constructor(config: StrapiClientConfig)')
        expect(result).toContain('super(config)')
    })

    it('should generate login method (renamed from auth.callback for POST /auth/local)', () => {
        expect(result).toContain('async login(')
        expect(result).toContain('data: LoginCredentials')
        expect(result).toContain('Promise<AuthResponse>')
        expect(result).toContain("method: 'POST'")
    })

    it('should generate register method', () => {
        expect(result).toContain('async register(')
        expect(result).toContain('data: RegisterData')
        expect(result).toContain('Promise<AuthResponse>')
    })

    it('dynamic me() should have 3 overloads with TFields + SelectFields', () => {
        // Overload 1: with populate object
        expect(result).toContain(
            "me<const TPopulate extends UserPopulateParam, const TFields extends Exclude<keyof User & string, '__typename'> = never>(",
        )
        expect(result).toContain(
            '    params: { populate: TPopulate } & QueryParams<User, UserFilters, TPopulate, TFields>,',
        )
        expect(result).toContain(
            '  ): Promise<SelectFields<GetPopulated<User, TPopulate>, User, TFields>>',
        )

        // Overload 2: with populate '*' or true
        expect(result).toContain(
            "    params: { populate: '*' | true } & QueryParams<User, UserFilters, '*' | true, TFields>,",
        )

        // Overload 3: general case
        expect(result).toContain(
            '  ): Promise<SelectFields<User, User, TFields>>',
        )

        // Implementation
        expect(result).toContain(
            'async me(params?: any, nextOptions?: any): Promise<any>',
        )
    })

    it('dynamic updateMe() should have 3 overloads with TFields + SelectFields', () => {
        // Overload 1: with data and populate object
        expect(result).toContain(
            "updateMe<const TPopulate extends UserPopulateParam, const TFields extends Exclude<keyof User & string, '__typename'> = never>(",
        )
        expect(result).toContain('    data: Partial<User>,')

        // Implementation
        expect(result).toContain(
            'async updateMe(data: Partial<User>, params?: any, nextOptions?: any): Promise<any>',
        )
        expect(result).toContain("method: 'PUT'")
        expect(result).toContain('body: JSON.stringify(data)')
    })

    it('should generate callback method with provider param for OAuth', () => {
        expect(result).toContain('async callback(')
        expect(result).toContain('provider: string,')
        expect(result).toContain('search?: string,')
        expect(result).toContain('Promise<AuthResponse>')
        expect(result).toContain('OAuth callback with query string support')
    })

    it('should generate count method from user routes', () => {
        expect(result).toContain('async count(')
        expect(result).toContain('GET /users/count')
        expect(result).toContain('Handler: user.count')
    })

    it('should NOT generate find/findOne/create/update/delete from user routes', () => {
        const userCrudRoutes: ParsedRoute[] = [
            {
                method: 'GET',
                path: '/users/me',
                handler: 'user.me',
                controller: 'user',
                action: 'me',
                params: [],
            },
            {
                method: 'PUT',
                path: '/users/me',
                handler: 'user.updateMe',
                controller: 'user',
                action: 'updateMe',
                params: [],
            },
            {
                method: 'GET',
                path: '/users/count',
                handler: 'user.count',
                controller: 'user',
                action: 'count',
                params: [],
            },
            {
                method: 'GET',
                path: '/users',
                handler: 'user.find',
                controller: 'user',
                action: 'find',
                params: [],
            },
            {
                method: 'GET',
                path: '/users/:id',
                handler: 'user.findOne',
                controller: 'user',
                action: 'findOne',
                params: ['id'],
            },
            {
                method: 'POST',
                path: '/users',
                handler: 'user.create',
                controller: 'user',
                action: 'create',
                params: [],
            },
            {
                method: 'PUT',
                path: '/users/:id',
                handler: 'user.update',
                controller: 'user',
                action: 'update',
                params: ['id'],
            },
            {
                method: 'DELETE',
                path: '/users/:id',
                handler: 'user.delete',
                controller: 'user',
                action: 'delete',
                params: ['id'],
            },
        ]

        const resultWithCrud = generator.generateAuthApiClass(
            authRoutes,
            userCrudRoutes,
        )

        // Special routes should be present
        expect(resultWithCrud).toContain('async me(')
        expect(resultWithCrud).toContain('async updateMe(')
        expect(resultWithCrud).toContain('async count(')

        // Standard CRUD routes should NOT be present in AuthAPI
        expect(resultWithCrud).not.toMatch(/async find\(/)
        expect(resultWithCrud).not.toMatch(/async findOne\(/)
        expect(resultWithCrud).not.toMatch(/async create\(/)
        expect(resultWithCrud).not.toMatch(/async update\(/)
        expect(resultWithCrud).not.toMatch(/async delete\(/)
    })
})
