import { describe, it, expect } from 'vitest'
import {
    convertComponentName,
    extractCleanName,
    toEndpointName,
    extractRelationTarget,
    extractComponentCategory,
} from '../../../src/shared/naming-utils'

describe('naming-utils', () => {
    describe('convertComponentName', () => {
        it('converts Strapi component UID to TypeScript name', () => {
            expect(convertComponentName('shared.feature')).toBe('SharedFeature')
            expect(convertComponentName('landing.editor-feature')).toBe(
                'LandingEditorFeature',
            )
        })

        it('handles single-part component names', () => {
            expect(convertComponentName('feature')).toBe('Feature')
        })

        it('handles kebab-case in component names', () => {
            expect(convertComponentName('shared.seo-data')).toBe(
                'SharedSeoData',
            )
        })
    })

    describe('extractCleanName', () => {
        it('extracts clean name from API interface', () => {
            expect(extractCleanName('ApiItemItem')).toBe('Item')
            expect(extractCleanName('ApiCategoryCategory')).toBe('Category')
        })

        it('handles Plugin types', () => {
            expect(extractCleanName('PluginUsersPermissionsUser')).toBe('User')
            expect(extractCleanName('PluginUsersPermissionsRole')).toBe('Role')
        })

        it('handles non-repeated names', () => {
            expect(extractCleanName('ApiAuth')).toBe('Auth')
        })
    })

    describe('toEndpointName', () => {
        it('converts clean name to pluralized kebab-case', () => {
            expect(toEndpointName('Item')).toBe('items')
            expect(toEndpointName('Category')).toBe('categories')
        })

        it('handles multi-word names', () => {
            expect(toEndpointName('SaveGame')).toBe('save-games')
            expect(toEndpointName('GuideType')).toBe('guide-types')
        })

        it('returns plain kebab-case for single types', () => {
            expect(toEndpointName('Homepage', true)).toBe('homepage')
            expect(toEndpointName('SiteConfig', true)).toBe('site-config')
        })
    })

    describe('extractRelationTarget', () => {
        it('extracts type name from API relation target', () => {
            expect(extractRelationTarget("'api::item.item'")).toBe('Item')
            expect(extractRelationTarget('api::category.category')).toBe(
                'Category',
            )
        })

        it('extracts type name from plugin relation target', () => {
            expect(
                extractRelationTarget("'plugin::users-permissions.user'"),
            ).toBe('User')
            expect(
                extractRelationTarget('plugin::users-permissions.role'),
            ).toBe('Role')
        })

        it('handles kebab-case in target names', () => {
            expect(extractRelationTarget("'api::guide-type.guide-type'")).toBe(
                'GuideType',
            )
        })
    })

    describe('extractComponentCategory', () => {
        it('extracts category from component UID', () => {
            expect(extractComponentCategory('landing.editor-feature')).toBe(
                'landing',
            )
            expect(extractComponentCategory('shared.seo')).toBe('shared')
        })
    })
})
