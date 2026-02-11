import { describe, it, expect } from 'vitest'
import { ClientGenerator } from '../../../src/generator/client-generator.js'
import type { ParsedSchema } from '../../../src/schema-types.js'

const mockSchema: ParsedSchema = {
    contentTypes: [
        {
            name: 'ApiItemItem',
            cleanName: 'Item',
            collectionName: 'items',
            kind: 'collection',
            attributes: [
                { name: 'title', type: { kind: 'string' }, required: true },
                { name: 'price', type: { kind: 'integer' }, required: false },
            ],
            relations: [
                {
                    name: 'category',
                    relationType: 'manyToOne',
                    target: 'api::category.category',
                    targetType: 'Category',
                    required: false,
                },
            ],
            media: [{ name: 'image', multiple: false, required: false }],
            components: [],
            dynamicZones: [],
        },
        {
            name: 'ApiCategoryCategory',
            cleanName: 'Category',
            collectionName: 'categories',
            kind: 'collection',
            attributes: [
                { name: 'name', type: { kind: 'string' }, required: true },
            ],
            relations: [],
            media: [],
            components: [],
            dynamicZones: [],
        },
        {
            name: 'PluginUsersPermissionsUser',
            cleanName: 'User',
            collectionName: 'up_users',
            kind: 'collection',
            attributes: [
                { name: 'email', type: { kind: 'string' }, required: true },
                { name: 'username', type: { kind: 'string' }, required: true },
            ],
            relations: [],
            media: [{ name: 'avatar', multiple: false, required: false }],
            components: [],
            dynamicZones: [],
        },
        {
            name: 'ApiHomepageHomepage',
            cleanName: 'Homepage',
            collectionName: 'homepages',
            kind: 'single',
            attributes: [
                { name: 'heading', type: { kind: 'string' }, required: true },
            ],
            relations: [],
            media: [{ name: 'banner', multiple: false, required: false }],
            components: [],
            dynamicZones: [],
        },
    ],
    components: [],
}

describe('ClientGenerator', () => {
    const generator = new ClientGenerator()
    const output = generator.generate(mockSchema)

    describe('Imports', () => {
        it('should import content types from types.js', () => {
            expect(output).toContain("from './types.js'")
            expect(output).toContain('Item')
            expect(output).toContain('Category')
            expect(output).toContain('User')
            expect(output).toContain('Homepage')
        })
        it('should import GetPayload types for types with populatable fields', () => {
            expect(output).toContain('ItemGetPayload')
            expect(output).toContain('UserGetPayload')
            expect(output).toContain('HomepageGetPayload')
            expect(output).not.toContain('CategoryGetPayload')
        })
        it('should import PopulateParam types for types with populatable fields', () => {
            expect(output).toContain('ItemPopulateParam')
            expect(output).toContain('UserPopulateParam')
            expect(output).toContain('HomepagePopulateParam')
            expect(output).not.toContain('CategoryPopulateParam')
        })
        it('should import Input types', () => {
            expect(output).toContain('ItemInput')
            expect(output).toContain('CategoryInput')
            expect(output).toContain('UserInput')
            expect(output).toContain('HomepageInput')
        })
        it('should import Filter types', () => {
            expect(output).toContain('ItemFilters')
            expect(output).toContain('CategoryFilters')
            expect(output).toContain('UserFilters')
            expect(output).toContain('HomepageFilters')
        })
        it('should import MediaFile', () => {
            expect(output).toContain('MediaFile')
        })
        it('should import qs', () => {
            expect(output).toContain("import qs from 'qs'")
        })
    })

    describe('Utility types', () => {
        it('should generate StrapiResponse interface', () => {
            expect(output).toContain('export interface StrapiResponse<T>')
            expect(output).toContain('data: T')
            expect(output).toContain('pagination?')
        })
        it('should generate StrapiError class', () => {
            expect(output).toContain('export class StrapiError extends Error')
            expect(output).toContain('userMessage: string')
            expect(output).toContain('status: number')
            expect(output).toContain('statusText: string')
            expect(output).toContain('details?: any')
        })
        it('should generate BaseAPI class with request and buildQueryString methods', () => {
            expect(output).toContain('class BaseAPI')
            expect(output).toContain('protected async request<R>(')
            expect(output).toContain(
                'protected buildQueryString(params?: QueryParams): string',
            )
        })
        it('should generate StrapiSortOption type excluding __typename', () => {
            expect(output).toContain(
                "type StrapiSortOption<T> = Exclude<keyof T & string, '__typename'>",
            )
        })
        it('should generate QueryParams with 4 generic parameters (TEntity, TFilters, TPopulate, TFields)', () => {
            expect(output).toContain(
                'export interface QueryParams<TEntity = any, TFilters = Record<string, any>, TPopulate = any, TFields extends string =',
            )
        })
        it('should generate QueryParams fields as TFields[]', () => {
            expect(output).toContain('fields?: TFields[]')
        })
        it('should generate NextOptions interface', () => {
            expect(output).toContain('export interface NextOptions')
            expect(output).toContain('revalidate?: number | false')
            expect(output).toContain('tags?: string[]')
            expect(output).toContain('cache?: RequestCache')
        })
        it('should generate StrapiClientConfig interface', () => {
            expect(output).toContain('export interface StrapiClientConfig')
            expect(output).toContain('baseURL: string')
            expect(output).toContain('token?: string')
            expect(output).toContain('fetch?: typeof fetch')
            expect(output).toContain('debug?: boolean')
            expect(output).toContain('credentials?: RequestCredentials')
        })
        it('should generate Equal utility type', () => {
            expect(output).toContain('type Equal<X, Y> =')
            expect(output).toContain('(<T>() => T extends X ? 1 : 2) extends')
            expect(output).toContain(
                '(<T>() => T extends Y ? 1 : 2) ? true : false',
            )
        })
        it('should generate GetPopulated type with conditional branches for each content type', () => {
            expect(output).toContain('type GetPopulated<TBase, TPopulate> =')
            expect(output).toContain(
                'Equal<TBase, Item> extends true ? ItemGetPayload<{ populate: TPopulate }> :',
            )
            expect(output).toContain(
                'Equal<TBase, User> extends true ? UserGetPayload<{ populate: TPopulate }> :',
            )
            expect(output).toContain(
                'Equal<TBase, Homepage> extends true ? HomepageGetPayload<{ populate: TPopulate }> :',
            )
            expect(output).not.toContain(
                'Equal<TBase, Category> extends true ? CategoryGetPayload',
            )
            expect(output).toContain('  TBase')
        })
        it('should generate SelectFields utility type', () => {
            expect(output).toContain(
                'type SelectFields<TFull, TBase, TFields extends string> =',
            )
            expect(output).toContain(
                "[TFields] extends [never] ? TFull : Pick<TBase, Extract<TFields | 'id' | 'documentId', keyof TBase>> & Omit<TFull, keyof TBase>",
            )
        })
    })

    describe('CollectionAPI', () => {
        it('should generate CollectionAPI class with 4 generic parameters', () => {
            expect(output).toContain('class CollectionAPI<')
            expect(output).toContain('TBase,')
            expect(output).toContain('TInput = Partial<TBase>,')
            expect(output).toContain('TFilters = Record<string, any>,')
            expect(output).toContain(
                'TPopulateKeys extends Record<string, any> = Record<string, any>',
            )
            expect(output).toContain('> extends BaseAPI {')
        })
        it('should generate find with 3 overloads', () => {
            const section = output.slice(
                output.indexOf('class CollectionAPI<'),
                output.indexOf('class SingleTypeAPI<'),
            )
            const findOverloads = section.match(/^\s+find</gm)
            expect(findOverloads).not.toBeNull()
            expect(findOverloads!.length).toBeGreaterThanOrEqual(3)
        })
        it('find overload 1 should have TPopulate and TFields generics with SelectFields return', () => {
            expect(output).toContain(
                "find<const TPopulate extends TPopulateKeys, const TFields extends Exclude<keyof TBase & string, '__typename'> = never>(",
            )
            expect(output).toContain(
                '): Promise<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields>[]>',
            )
        })
        it("find overload 2 should handle populate '*' | true with SelectFields return", () => {
            const section = output.slice(
                output.indexOf('class CollectionAPI<'),
                output.indexOf('class SingleTypeAPI<'),
            )
            expect(section).toContain("params: { populate: '*' | true }")
            expect(section).toContain(
                "Promise<SelectFields<GetPopulated<TBase, '*'>, TBase, TFields>[]>",
            )
        })
        it('find overload 3 should be general case with SelectFields return', () => {
            const section = output.slice(
                output.indexOf('class CollectionAPI<'),
                output.indexOf('class SingleTypeAPI<'),
            )
            expect(section).toContain(
                'Promise<SelectFields<TBase, TBase, TFields>[]>',
            )
        })
        it('should generate findOne with 3 overloads (with documentId parameter)', () => {
            const section = output.slice(
                output.indexOf('class CollectionAPI<'),
                output.indexOf('class SingleTypeAPI<'),
            )
            const findOneOverloads = section.match(/^\s+findOne</gm)
            expect(findOneOverloads).not.toBeNull()
            expect(findOneOverloads!.length).toBeGreaterThanOrEqual(3)
            expect(section).toContain(
                'findOne<const TPopulate extends TPopulateKeys',
            )
            expect(section).toContain('documentId: string,')
        })
        it('should generate create method with TInput | FormData', () => {
            expect(output).toContain(
                'async create(data: TInput | FormData, nextOptions?: NextOptions): Promise<TBase>',
            )
        })
        it('should generate update method', () => {
            expect(output).toContain(
                'async update(documentId: string, data: TInput | FormData, nextOptions?: NextOptions): Promise<TBase>',
            )
        })
        it('should generate delete method', () => {
            expect(output).toContain(
                'async delete(documentId: string, nextOptions?: NextOptions): Promise<TBase | null>',
            )
        })
    })

    describe('CollectionAPI findWithMeta', () => {
        it('should generate findWithMeta method', () => {
            const section = output.slice(
                output.indexOf('class CollectionAPI<'),
                output.indexOf('class SingleTypeAPI<'),
            )
            expect(section).toContain(
                'async findWithMeta(params?: any, nextOptions?: any): Promise<any>',
            )
        })
        it('findWithMeta should have 3 overloads', () => {
            const section = output.slice(
                output.indexOf('class CollectionAPI<'),
                output.indexOf('class SingleTypeAPI<'),
            )
            const overloads = section.match(/^\s+findWithMeta</gm)
            expect(overloads).not.toBeNull()
            expect(overloads!.length).toBeGreaterThanOrEqual(3)
        })
        it('findWithMeta overloads should return StrapiResponse wrapping the array', () => {
            const section = output.slice(
                output.indexOf('class CollectionAPI<'),
                output.indexOf('class SingleTypeAPI<'),
            )
            expect(section).toContain(
                'Promise<StrapiResponse<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields>[]>>',
            )
            expect(section).toContain(
                "Promise<StrapiResponse<SelectFields<GetPopulated<TBase, '*'>, TBase, TFields>[]>>",
            )
            expect(section).toContain(
                'Promise<StrapiResponse<SelectFields<TBase, TBase, TFields>[]>>',
            )
        })
        it('findWithMeta implementation should return full response (not response.data)', () => {
            const section = output.slice(
                output.indexOf('class CollectionAPI<'),
                output.indexOf('class SingleTypeAPI<'),
            )
            // findWithMeta returns the full response
            expect(section).toContain(
                'return this.request<StrapiResponse<any[]>>(url, {}, nextOptions)',
            )
        })
    })

    describe('SingleTypeAPI', () => {
        it('should generate SingleTypeAPI class with 4 generic parameters', () => {
            expect(output).toContain('class SingleTypeAPI<')
            const section = output.slice(
                output.indexOf('class SingleTypeAPI<'),
                output.indexOf('class SingleTypeAPI<') + 500,
            )
            expect(section).toContain('TBase,')
            expect(section).toContain('TInput = Partial<TBase>,')
            expect(section).toContain('TFilters = Record<string, any>,')
            expect(section).toContain(
                'TPopulateKeys extends Record<string, any> = Record<string, any>',
            )
        })
        it('should generate find with 3 overloads (no array in return type)', () => {
            const section = output.slice(
                output.indexOf('class SingleTypeAPI<'),
                output.indexOf(
                    '// Auth API wrapper for users-permissions plugin',
                ),
            )
            expect(section).toContain(
                '): Promise<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields>>',
            )
            const nonArrayReturns = section.match(
                /Promise<SelectFields<GetPopulated<TBase, TPopulate>, TBase, TFields>>\s*$/gm,
            )
            expect(nonArrayReturns).not.toBeNull()
        })
        it('should generate update method (no delete, no create)', () => {
            const section = output.slice(
                output.indexOf('class SingleTypeAPI<'),
                output.indexOf(
                    '// Auth API wrapper for users-permissions plugin',
                ),
            )
            expect(section).toContain(
                'async update(data: TInput | FormData, nextOptions?: NextOptions): Promise<TBase>',
            )
            expect(section).not.toContain('async delete(')
            expect(section).not.toContain('async create(')
        })
    })

    describe('StrapiClient', () => {
        it('should generate StrapiClient class', () => {
            expect(output).toContain('export class StrapiClient')
        })
        it('should have authentication property of AuthAPI type', () => {
            expect(output).toContain('authentication: AuthAPI')
        })
        it('should create CollectionAPI instances for collection types (items, categories, users)', () => {
            expect(output).toContain(
                "this.items = new CollectionAPI('items', this.config)",
            )
            expect(output).toContain(
                "this.categories = new CollectionAPI('categories', this.config)",
            )
            expect(output).toContain(
                "this.users = new CollectionAPI('users', this.config)",
            )
        })
        it('should create SingleTypeAPI instance for single types (homepage)', () => {
            expect(output).toContain(
                "this.homepage = new SingleTypeAPI('homepage', this.config)",
            )
        })
        it('should include type parameters for types with populatable fields (4 params)', () => {
            expect(output).toContain(
                'items: CollectionAPI<Item, ItemInput, ItemFilters, ItemPopulateParam>',
            )
            expect(output).toContain(
                'users: CollectionAPI<User, UserInput, UserFilters, UserPopulateParam>',
            )
            expect(output).toContain(
                'homepage: SingleTypeAPI<Homepage, HomepageInput, HomepageFilters, HomepagePopulateParam>',
            )
        })
        it('should include type parameters for types without populatable fields (3 params)', () => {
            expect(output).toContain(
                'categories: CollectionAPI<Category, CategoryInput, CategoryFilters>',
            )
        })
        it('should have setToken method', () => {
            expect(output).toContain('setToken(token: string)')
            expect(output).toContain('this.config.token = token')
        })
        it('should have validateSchema method', () => {
            expect(output).toContain('async validateSchema()')
            expect(output).toContain('SCHEMA_HASH')
            expect(output).toContain('schema-hash')
        })
    })

    describe('Auth types', () => {
        it('should generate LoginCredentials interface', () => {
            expect(output).toContain('export interface LoginCredentials')
            expect(output).toContain('identifier: string')
            expect(output).toContain('password: string')
        })
        it('should generate RegisterData interface', () => {
            expect(output).toContain('export interface RegisterData')
            expect(output).toContain('username: string')
            expect(output).toContain('email: string')
        })
        it('should generate AuthResponse interface', () => {
            expect(output).toContain('export interface AuthResponse')
            expect(output).toContain('jwt: string')
            expect(output).toContain('user: User')
        })
        it('should generate AuthAPI class', () => {
            expect(output).toContain('class AuthAPI extends BaseAPI')
        })
    })

    describe('AuthAPI overloads', () => {
        it('me() should have 3 overloads with TFields generic', () => {
            const authSection = output.slice(
                output.indexOf('class AuthAPI extends BaseAPI'),
            )
            const meOverloads = authSection.match(/^\s+me</gm)
            expect(meOverloads).not.toBeNull()
            expect(meOverloads!.length).toBe(3)
        })
        it('me() overload 1 should use SelectFields<GetPopulated<User, TPopulate>, User, TFields>', () => {
            expect(output).toContain(
                "me<const TPopulate extends UserPopulateParam, const TFields extends Exclude<keyof User & string, '__typename'> = never>",
            )
            expect(output).toContain(
                'Promise<SelectFields<GetPopulated<User, TPopulate>, User, TFields>>',
            )
        })
        it("me() overload 2 should handle populate '*' | true", () => {
            const authSection = output.slice(
                output.indexOf('class AuthAPI extends BaseAPI'),
            )
            expect(authSection).toContain(
                "params: { populate: '*' | true } & QueryParams<User, UserFilters, '*' | true, TFields>",
            )
            expect(authSection).toContain(
                "Promise<SelectFields<GetPopulated<User, '*'>, User, TFields>>",
            )
        })
        it('me() overload 3 should be general case', () => {
            const authSection = output.slice(
                output.indexOf('class AuthAPI extends BaseAPI'),
            )
            expect(authSection).toContain(
                "params?: QueryParams<User, UserFilters, UserPopulateParam | (keyof UserPopulateParam & string)[] | '*' | boolean, TFields>",
            )
            expect(authSection).toContain(
                'Promise<SelectFields<User, User, TFields>>',
            )
        })
        it('updateMe() should have 3 overloads with TFields generic', () => {
            const authSection = output.slice(
                output.indexOf('class AuthAPI extends BaseAPI'),
            )
            const updateMeOverloads = authSection.match(/^\s+updateMe</gm)
            expect(updateMeOverloads).not.toBeNull()
            expect(updateMeOverloads!.length).toBe(3)
        })
        it('updateMe() should accept Partial<User> as data parameter', () => {
            const authSection = output.slice(
                output.indexOf('class AuthAPI extends BaseAPI'),
            )
            expect(authSection).toContain('data: Partial<User>,')
        })
    })
})
