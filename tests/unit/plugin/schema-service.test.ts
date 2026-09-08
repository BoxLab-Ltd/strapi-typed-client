import { describe, it, expect } from 'vitest'
import schemaService from '../../../src/plugin/server/src/services/schema.js'

/**
 * The creator fields are the one place where the plugin must not decide for
 * itself: Strapi's addCreatorFields sets `private: !options.populateCreatorFields`
 * on both attributes, so the private flag already carries the content type's
 * opt-in. These fixtures reproduce that attribute exactly as
 * @strapi/core/domain/content-type builds it, in both states.
 */
function creatorAttribute(populateCreatorFields: boolean) {
    return {
        type: 'relation',
        relation: 'oneToOne',
        target: 'admin::user',
        configurable: false,
        writable: false,
        visible: false,
        useJoinTable: false,
        private: !populateCreatorFields,
    }
}

function strapiStub(populateCreatorFields: boolean, extra = {}) {
    return {
        contentTypes: {
            'api::article.article': {
                uid: 'api::article.article',
                kind: 'collectionType',
                collectionName: 'articles',
                info: {
                    singularName: 'article',
                    pluralName: 'articles',
                    displayName: 'Article',
                },
                attributes: {
                    title: { type: 'string', required: true },
                    createdBy: creatorAttribute(populateCreatorFields),
                    updatedBy: creatorAttribute(populateCreatorFields),
                    ...extra,
                },
            },
        },
        components: {},
        config: { get: () => undefined },
    }
}

function attributesOf(strapi: unknown) {
    const service = schemaService({ strapi } as { strapi: never })
    return service.extractSchema().contentTypes['api::article.article']!
        .attributes
}

describe('plugin schema service — creator fields', () => {
    it('drops them when populateCreatorFields is off', () => {
        const attributes = attributesOf(strapiStub(false))

        expect(Object.keys(attributes)).toEqual(['title'])
    })

    it('forwards them when populateCreatorFields is on', () => {
        const attributes = attributesOf(strapiStub(true))

        expect(Object.keys(attributes)).toEqual([
            'title',
            'createdBy',
            'updatedBy',
        ])
        expect(attributes.createdBy!.target).toBe('admin::user')
        // Carried through so the transformer can keep them out of input types.
        expect(attributes.createdBy!.writable).toBe(false)
    })

    it('still drops every other admin relation', () => {
        const attributes = attributesOf(
            strapiStub(true, {
                owningRole: {
                    type: 'relation',
                    relation: 'oneToOne',
                    target: 'admin::role',
                },
            }),
        )

        expect(Object.keys(attributes)).not.toContain('owningRole')
    })
})
