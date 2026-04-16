import { describe, it, expect } from 'vitest'
import qs from 'qs'
import { stringifyQuery } from '../../../src/generator/templates/stringify-query.js'

function qsReference(obj: Record<string, unknown>): string {
    return qs.stringify(obj, { encodeValuesOnly: true, skipNulls: true })
}

const fixtures: Array<[string, Record<string, unknown>]> = [
    ['flat primitives', { page: 1, pageSize: 25, sort: 'name' }],
    ['boolean', { publish: true, draft: false }],
    [
        'nested filters',
        { filters: { name: { $eq: 'foo' }, age: { $gte: 18 } } },
    ],
    [
        'deep populate',
        {
            populate: {
                category: { fields: ['name', 'slug'] },
                image: true,
            },
        },
    ],
    ['sort array', { sort: ['name:asc', 'createdAt:desc'] }],
    ['pagination', { pagination: { page: 2, pageSize: 10 } }],
    [
        'logical operators',
        {
            filters: {
                $or: [{ name: { $contains: 'foo' } }, { slug: { $eq: 'bar' } }],
            },
        },
    ],
    [
        'values needing URL-encoding',
        { filters: { q: { $contains: 'hello world & more=stuff' } } },
    ],
    ['unicode values', { filters: { title: { $eq: 'тест значение' } } }],
    [
        'skip nulls',
        {
            filters: { name: null, slug: 'abc' },
            populate: undefined,
        },
    ],
    [
        'Date values',
        {
            filters: {
                createdAt: { $gte: new Date('2025-01-01T00:00:00Z') },
            },
        },
    ],
    [
        'realistic find request',
        {
            filters: {
                $and: [
                    { category: { slug: { $eq: 'news' } } },
                    { publishedAt: { $notNull: true } },
                ],
            },
            populate: {
                category: true,
                cover: { fields: ['url', 'width', 'height'] },
            },
            sort: ['publishedAt:desc'],
            pagination: { page: 1, pageSize: 10 },
        },
    ],
]

describe('vendored stringifyQuery', () => {
    for (const [name, input] of fixtures) {
        it(`matches qs.stringify for: ${name}`, () => {
            expect(stringifyQuery(input)).toBe(qsReference(input))
        })
    }

    it('returns empty string for empty object', () => {
        expect(stringifyQuery({})).toBe('')
    })
})
