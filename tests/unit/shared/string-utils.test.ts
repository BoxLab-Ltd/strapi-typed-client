import { describe, it, expect } from 'vitest'
import {
    toCamelCase,
    toLowerFirst,
    toPascalCase,
    toPascalCasePreserve,
    toKebabCase,
    toSnakeCase,
    capitalize,
    pluralize,
    extractPathParams,
} from '../../../src/shared/string-utils'

describe('string-utils', () => {
    describe('toCamelCase', () => {
        it('converts kebab-case to camelCase', () => {
            expect(toCamelCase('forgot-password')).toBe('forgotPassword')
            expect(toCamelCase('create-item')).toBe('createItem')
        })

        it('converts snake_case to camelCase', () => {
            expect(toCamelCase('create_item')).toBe('createItem')
            expect(toCamelCase('update_user_profile')).toBe('updateUserProfile')
        })

        it('handles already camelCase strings', () => {
            expect(toCamelCase('forgotPassword')).toBe('forgotPassword')
        })
    })

    describe('toLowerFirst', () => {
        it('lowercases first character', () => {
            expect(toLowerFirst('CreateCheckout')).toBe('createCheckout')
            expect(toLowerFirst('UpdateCode')).toBe('updateCode')
        })

        it('handles already lowercase first character', () => {
            expect(toLowerFirst('create')).toBe('create')
        })
    })

    describe('toPascalCase', () => {
        it('converts kebab-case to PascalCase', () => {
            expect(toPascalCase('team-invitation')).toBe('TeamInvitation')
            expect(toPascalCase('custom-upload')).toBe('CustomUpload')
        })

        it('converts snake_case to PascalCase', () => {
            expect(toPascalCase('team_invitation')).toBe('TeamInvitation')
        })

        it('handles single word', () => {
            expect(toPascalCase('subscription')).toBe('Subscription')
        })
    })

    describe('toKebabCase', () => {
        it('converts PascalCase to kebab-case', () => {
            expect(toKebabCase('TeamInvitation')).toBe('team-invitation')
            expect(toKebabCase('CustomUpload')).toBe('custom-upload')
        })

        it('converts camelCase to kebab-case', () => {
            expect(toKebabCase('customUpload')).toBe('custom-upload')
        })
    })

    describe('toSnakeCase', () => {
        it('converts PascalCase to snake_case', () => {
            expect(toSnakeCase('TeamInvitation')).toBe('team_invitation')
            expect(toSnakeCase('CustomUpload')).toBe('custom_upload')
        })

        it('converts camelCase to snake_case', () => {
            expect(toSnakeCase('customUpload')).toBe('custom_upload')
        })
    })

    describe('capitalize', () => {
        it('capitalizes first letter', () => {
            expect(capitalize('hello')).toBe('Hello')
            expect(capitalize('world')).toBe('World')
        })
    })

    describe('pluralize', () => {
        it('pluralizes regular words', () => {
            expect(pluralize('item')).toBe('items')
            expect(pluralize('user')).toBe('users')
        })

        it('handles words ending in y', () => {
            expect(pluralize('category')).toBe('categories')
            expect(pluralize('city')).toBe('cities')
        })

        it('handles words ending in vowel + y', () => {
            expect(pluralize('key')).toBe('keys')
            expect(pluralize('boy')).toBe('boys')
        })

        it('handles words ending in s, x, ch, sh', () => {
            expect(pluralize('boss')).toBe('bosses')
            expect(pluralize('box')).toBe('boxes')
            expect(pluralize('match')).toBe('matches')
            expect(pluralize('dish')).toBe('dishes')
        })
    })

    describe('toPascalCasePreserve', () => {
        it('converts kebab-case preserving abbreviations', () => {
            expect(toPascalCasePreserve('ai-studio')).toBe('AIStudio')
        })

        it('converts regular kebab-case to PascalCase', () => {
            expect(toPascalCasePreserve('team-invitation')).toBe(
                'TeamInvitation',
            )
        })

        it('handles single word', () => {
            expect(toPascalCasePreserve('subscription')).toBe('Subscription')
        })
    })

    describe('extractPathParams', () => {
        it('extracts params from path', () => {
            expect(extractPathParams('/items/:id/action')).toEqual(['id'])
        })

        it('extracts multiple params', () => {
            expect(extractPathParams('/auth/:provider/callback/:code')).toEqual(
                ['provider', 'code'],
            )
        })

        it('returns empty array when no params', () => {
            expect(extractPathParams('/items')).toEqual([])
        })
    })
})
