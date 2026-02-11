import { describe, it, expect } from 'vitest'
import { TypesGenerator } from '../../../src/generator/types-generator.js'
import type {
    ParsedSchema,
    ContentType,
    Component,
} from '../../../src/schema-types.js'

// ------------------------------------------------------------------
// Mock schema
// ------------------------------------------------------------------

const mockComponents: Component[] = [
    {
        name: 'ProjectConfig',
        cleanName: 'ProjectConfig',
        category: 'project',
        attributes: [
            { name: 'key', type: { kind: 'string' }, required: true },
            { name: 'value', type: { kind: 'string' }, required: true },
        ],
        relations: [],
        media: [],
        components: [],
        dynamicZones: [],
    },
    {
        name: 'LandingHero',
        cleanName: 'LandingHero',
        category: 'landing',
        attributes: [
            { name: 'title', type: { kind: 'string' }, required: true },
        ],
        relations: [],
        media: [{ name: 'image', multiple: false, required: true }],
        components: [],
        dynamicZones: [],
    },
    {
        name: 'LandingFeature',
        cleanName: 'LandingFeature',
        category: 'landing',
        attributes: [
            { name: 'label', type: { kind: 'string' }, required: true },
        ],
        relations: [
            {
                name: 'item',
                relationType: 'manyToOne',
                target: 'api::item.item',
                targetType: 'Item',
                required: false,
            },
        ],
        media: [],
        components: [],
        dynamicZones: [],
    },
]

const mockContentTypes: ContentType[] = [
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
        name: 'ApiProjectProject',
        cleanName: 'Project',
        collectionName: 'projects',
        kind: 'collection',
        attributes: [
            { name: 'title', type: { kind: 'string' }, required: true },
        ],
        relations: [
            {
                name: 'items',
                relationType: 'oneToMany',
                target: 'api::item.item',
                targetType: 'Item',
                required: false,
            },
            {
                name: 'owner',
                relationType: 'manyToOne',
                target: 'plugin::users-permissions.user',
                targetType: 'User',
                required: false,
            },
        ],
        media: [{ name: 'images', multiple: true, required: false }],
        components: [
            {
                name: 'config',
                component: 'project.config',
                componentType: 'ProjectConfig',
                repeatable: true,
                required: false,
            },
        ],
        dynamicZones: [
            {
                name: 'sections',
                components: ['landing.hero', 'landing.feature'],
                componentTypes: ['LandingHero', 'LandingFeature'],
                required: false,
            },
        ],
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
        relations: [
            {
                name: 'projects',
                relationType: 'oneToMany',
                target: 'api::project.project',
                targetType: 'Project',
                required: false,
            },
        ],
        media: [],
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
]

const mockSchema: ParsedSchema = {
    contentTypes: mockContentTypes,
    components: mockComponents,
}

// Generate output once for all tests
const generator = new TypesGenerator()
const output = generator.generate(mockSchema)

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('TypesGenerator', () => {
    // ================================================================
    // Helper types
    // ================================================================
    describe('Helper types', () => {
        it('should generate _EntityField helper type', () => {
            expect(output).toContain(
                "type _EntityField<T> = Exclude<keyof T & string, '__typename'>",
            )
        })

        it('should generate _SortValue helper type', () => {
            expect(output).toContain(
                'type _SortValue<T> = _EntityField<T> | `${_EntityField<T>}:${"asc" | "desc"}`',
            )
        })

        it('should generate _ApplyFields helper type', () => {
            expect(output).toContain(
                "type _ApplyFields<TFull, TBase, TEntry> = TEntry extends true ? TFull : TEntry extends { fields: readonly (infer F)[] } ? F extends string ? Pick<TBase, Extract<F | 'id' | 'documentId', keyof TBase>> & Omit<TFull, keyof TBase> : TFull : TFull",
            )
        })
    })

    // ================================================================
    // Base types
    // ================================================================
    describe('Base types', () => {
        it('should generate MediaFile interface', () => {
            expect(output).toContain('export interface MediaFile {')
            expect(output).toContain('  id: number')
            expect(output).toContain('  name: string')
            expect(output).toContain('  url: string')
            expect(output).toContain('  mime: string')
            expect(output).toContain('  width: number | null')
            expect(output).toContain('  height: number | null')
            expect(output).toContain('  alternativeText: string | null')
        })

        it('should generate BlocksContent type', () => {
            expect(output).toContain('export type BlocksContent = Block[]')
            expect(output).toContain('export type Block =')
            expect(output).toContain('ParagraphBlock')
            expect(output).toContain('HeadingBlock')
            expect(output).toContain('ImageBlock')
        })
    })

    // ================================================================
    // Content type interfaces
    // ================================================================
    describe('Content type interfaces', () => {
        it('should generate Category interface with __typename and base fields', () => {
            expect(output).toContain('export interface Category {')
            expect(output).toContain("  readonly __typename?: 'Category'")
            expect(output).toContain('  id: number')
            expect(output).toContain('  documentId: string')
            expect(output).toContain('  createdAt: string')
            expect(output).toContain('  updatedAt: string')
            expect(output).toContain('  name: string')
        })

        it('should generate Item interface with relation as { id, documentId } | null', () => {
            expect(output).toContain('export interface Item {')
            expect(output).toContain("  readonly __typename?: 'Item'")
            expect(output).toContain('  title: string')
            expect(output).toContain('  price: number | null')
        })

        it('should generate Project interface with oneToMany relation as array', () => {
            expect(output).toContain('export interface Project {')
            expect(output).toContain("  readonly __typename?: 'Project'")
            expect(output).toContain('  title: string')
        })

        it('should generate Homepage single type interface', () => {
            expect(output).toContain('export interface Homepage {')
            expect(output).toContain("  readonly __typename?: 'Homepage'")
            expect(output).toContain('  heading: string')
        })
    })

    // ================================================================
    // Component interfaces
    // ================================================================
    describe('Component interfaces', () => {
        it('should generate ProjectConfig component with id field', () => {
            expect(output).toContain('export interface ProjectConfig {')
            expect(output).toContain('  id: number')
            expect(output).toContain('  key: string')
            expect(output).toContain('  value: string')
        })

        it('should generate LandingHero component with media field', () => {
            expect(output).toContain('export interface LandingHero {')
            expect(output).toContain('  id: number')
            expect(output).toContain('  title: string')
            expect(output).toContain('  image: MediaFile')
        })
    })

    // ================================================================
    // Input types
    // ================================================================
    describe('Input types', () => {
        it('should generate CategoryInput with optional fields', () => {
            expect(output).toContain('export interface CategoryInput {')
            expect(output).toContain('  name?: string')
        })

        it('should generate ItemInput with media as number | null and relation as number | null', () => {
            expect(output).toContain('export interface ItemInput {')
            expect(output).toContain('  title?: string')
            expect(output).toContain('  price?: number')
            expect(output).toContain('  image?: number | null')
            expect(output).toContain('  category?: number | null')
        })

        it('should generate ProjectConfigInput for component', () => {
            expect(output).toContain('export interface ProjectConfigInput {')
            expect(output).toContain('  id?: number')
            expect(output).toContain('  key?: string')
            expect(output).toContain('  value?: string')
        })
    })

    // ================================================================
    // PopulateParam types
    // ================================================================
    describe('PopulateParam types', () => {
        it('should NOT generate PopulateParam for Category (no populatable fields)', () => {
            expect(output).not.toContain('export type CategoryPopulateParam')
        })

        it('should generate ItemPopulateParam with relation and media entries', () => {
            expect(output).toContain('export type ItemPopulateParam = {')
            expect(output).toContain('  category?: true | {')
            expect(output).toContain(
                '  image?: true | { fields?: (keyof MediaFile & string)[] }',
            )
        })

        it('should generate ProjectPopulateParam with relation, media, component, and dynamic zone entries', () => {
            expect(output).toContain('export type ProjectPopulateParam = {')
            expect(output).toContain('  items?: true | {')
            expect(output).toContain('  owner?: true | {')
            expect(output).toContain(
                '  images?: true | { fields?: (keyof MediaFile & string)[] }',
            )
            expect(output).toContain('  config?: true | {')
            expect(output).toContain('  sections?: true | { on?: {')
        })

        it('PopulateParam relation should have fields, populate, filters, sort, limit, start options', () => {
            expect(output).toContain('fields?: _EntityField<Category>[]')
            expect(output).toContain('filters?: CategoryFilters')
            expect(output).toContain(
                'sort?: _SortValue<Category> | _SortValue<Category>[]',
            )
            expect(output).toContain('limit?: number')
            expect(output).toContain('start?: number')
        })

        it('PopulateParam media should have true | { fields?: (keyof MediaFile & string)[] }', () => {
            expect(output).toContain(
                'image?: true | { fields?: (keyof MediaFile & string)[] }',
            )
        })

        it('PopulateParam component should have fields and populate options', () => {
            expect(output).toContain(
                'config?: true | { fields?: (keyof ProjectConfig & string)[]',
            )
        })

        it('PopulateParam dynamic zone should have on fragment syntax with component UIDs', () => {
            expect(output).toContain('sections?: true | { on?: {')
            expect(output).toContain("'landing.hero'?:")
            expect(output).toContain("'landing.feature'?:")
        })

        it('should generate UserPopulateParam for User type', () => {
            expect(output).toContain('export type UserPopulateParam = {')
            expect(output).toContain('  projects?: true | {')
        })
    })

    // ================================================================
    // GetPayload types
    // ================================================================
    describe('GetPayload types', () => {
        it('should NOT generate GetPayload for Category (no populatable fields)', () => {
            expect(output).not.toContain('CategoryGetPayload')
        })

        it('should generate ItemGetPayload with populate support', () => {
            expect(output).toContain(
                'export type ItemGetPayload<P extends { populate?: any } = {}> =',
            )
            expect(output).toContain('Item &')
        })

        it("GetPayload should have branch for Pop extends '*' | true (all fields)", () => {
            expect(output).toContain("Pop extends '*' | true")
        })

        it('GetPayload should have branch for Pop extends readonly array', () => {
            expect(output).toContain('Pop extends readonly (infer _)[]')
        })

        it('GetPayload should have branch for per-field object populate', () => {
            expect(output).toContain("category?: 'category' extends keyof Pop")
            expect(output).toContain("image?: 'image' extends keyof Pop")
        })

        it('Per-field populate should use _ApplyFields wrapper', () => {
            expect(output).toContain('_ApplyFields<Category, Category,')
            expect(output).toContain('_ApplyFields<MediaFile, MediaFile,')
        })

        it('Array populate should check field extends Pop[number]', () => {
            expect(output).toContain(
                "'category' extends Pop[number] ? Category",
            )
            expect(output).toContain("'image' extends Pop[number] ? MediaFile")
        })
    })

    // ================================================================
    // Component GetPayload types
    // ================================================================
    describe('Component GetPayload types', () => {
        it('should generate LandingHeroGetPayload for component with media', () => {
            expect(output).toContain(
                'export type LandingHeroGetPayload<P extends { populate?: any } = {}> =',
            )
            expect(output).toContain('LandingHero &')
        })

        it('should generate LandingFeatureGetPayload for component with relation', () => {
            expect(output).toContain(
                'export type LandingFeatureGetPayload<P extends { populate?: any } = {}> =',
            )
            expect(output).toContain('LandingFeature &')
        })
    })
})
