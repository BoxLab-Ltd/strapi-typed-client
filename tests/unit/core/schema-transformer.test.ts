import { describe, it, expect } from 'vitest'
import {
    transformSchema,
    ExtractedSchema,
    StrapiContentType,
    StrapiComponent,
} from '../../../src/core/schema-transformer.js'

describe('Schema Transformer', () => {
    describe('transformSchema', () => {
        it('should transform empty schema', () => {
            const extracted: ExtractedSchema = {
                contentTypes: {},
                components: {},
            }

            const result = transformSchema(extracted)

            expect(result.contentTypes).toHaveLength(0)
            expect(result.components).toHaveLength(0)
        })

        it('should transform a simple content type', () => {
            const extracted: ExtractedSchema = {
                contentTypes: {
                    'api::item.item': {
                        uid: 'api::item.item',
                        kind: 'collectionType',
                        collectionName: 'items',
                        info: {
                            singularName: 'item',
                            pluralName: 'items',
                            displayName: 'Item',
                        },
                        attributes: {
                            title: { type: 'string', required: true },
                            description: { type: 'text' },
                            count: { type: 'integer' },
                        },
                    },
                },
                components: {},
            }

            const result = transformSchema(extracted)

            expect(result.contentTypes).toHaveLength(1)
            expect(result.contentTypes[0].cleanName).toBe('Item')
            expect(result.contentTypes[0].kind).toBe('collection')
            expect(result.contentTypes[0].collectionName).toBe('items')
            expect(result.contentTypes[0].attributes).toHaveLength(3)

            // Check attribute transformation
            const titleAttr = result.contentTypes[0].attributes.find(
                a => a.name === 'title',
            )
            expect(titleAttr).toBeDefined()
            expect(titleAttr!.required).toBe(true)
            expect(titleAttr!.type.kind).toBe('string')
        })

        it('should transform single type', () => {
            const extracted: ExtractedSchema = {
                contentTypes: {
                    'api::homepage.homepage': {
                        uid: 'api::homepage.homepage',
                        kind: 'singleType',
                        collectionName: 'homepages',
                        info: {
                            singularName: 'homepage',
                            pluralName: 'homepages',
                            displayName: 'Homepage',
                        },
                        attributes: {
                            heroTitle: { type: 'string', required: true },
                        },
                    },
                },
                components: {},
            }

            const result = transformSchema(extracted)

            expect(result.contentTypes).toHaveLength(1)
            expect(result.contentTypes[0].kind).toBe('single')
        })

        it('should transform relations', () => {
            const extracted: ExtractedSchema = {
                contentTypes: {
                    'api::post.post': {
                        uid: 'api::post.post',
                        kind: 'collectionType',
                        collectionName: 'posts',
                        info: {
                            singularName: 'post',
                            pluralName: 'posts',
                            displayName: 'Post',
                        },
                        attributes: {
                            author: {
                                type: 'relation',
                                relation: 'manyToOne',
                                target: 'plugin::users-permissions.user',
                            },
                            categories: {
                                type: 'relation',
                                relation: 'manyToMany',
                                target: 'api::category.category',
                            },
                        },
                    },
                },
                components: {},
            }

            const result = transformSchema(extracted)

            expect(result.contentTypes[0].relations).toHaveLength(2)

            const authorRel = result.contentTypes[0].relations.find(
                r => r.name === 'author',
            )
            expect(authorRel).toBeDefined()
            expect(authorRel!.relationType).toBe('manyToOne')
            expect(authorRel!.targetType).toBe('User')

            const categoriesRel = result.contentTypes[0].relations.find(
                r => r.name === 'categories',
            )
            expect(categoriesRel).toBeDefined()
            expect(categoriesRel!.relationType).toBe('manyToMany')
            expect(categoriesRel!.targetType).toBe('Category')
        })

        it('should skip admin relations', () => {
            const extracted: ExtractedSchema = {
                contentTypes: {
                    'api::post.post': {
                        uid: 'api::post.post',
                        kind: 'collectionType',
                        collectionName: 'posts',
                        info: {
                            singularName: 'post',
                            pluralName: 'posts',
                            displayName: 'Post',
                        },
                        attributes: {
                            createdBy: {
                                type: 'relation',
                                relation: 'oneToOne',
                                target: 'admin::user',
                            },
                        },
                    },
                },
                components: {},
            }

            const result = transformSchema(extracted)

            expect(result.contentTypes[0].relations).toHaveLength(0)
        })

        it('should transform media fields', () => {
            const extracted: ExtractedSchema = {
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
                            cover: {
                                type: 'media',
                                multiple: false,
                                required: true,
                            },
                            gallery: {
                                type: 'media',
                                multiple: true,
                            },
                        },
                    },
                },
                components: {},
            }

            const result = transformSchema(extracted)

            expect(result.contentTypes[0].media).toHaveLength(2)

            const coverMedia = result.contentTypes[0].media.find(
                m => m.name === 'cover',
            )
            expect(coverMedia).toBeDefined()
            expect(coverMedia!.multiple).toBe(false)
            expect(coverMedia!.required).toBe(true)

            const galleryMedia = result.contentTypes[0].media.find(
                m => m.name === 'gallery',
            )
            expect(galleryMedia).toBeDefined()
            expect(galleryMedia!.multiple).toBe(true)
        })

        it('should transform component fields', () => {
            const extracted: ExtractedSchema = {
                contentTypes: {
                    'api::page.page': {
                        uid: 'api::page.page',
                        kind: 'collectionType',
                        collectionName: 'pages',
                        info: {
                            singularName: 'page',
                            pluralName: 'pages',
                            displayName: 'Page',
                        },
                        attributes: {
                            seo: {
                                type: 'component',
                                component: 'shared.seo',
                                repeatable: false,
                            },
                            features: {
                                type: 'component',
                                component: 'landing.feature',
                                repeatable: true,
                                required: true,
                            },
                        },
                    },
                },
                components: {},
            }

            const result = transformSchema(extracted)

            expect(result.contentTypes[0].components).toHaveLength(2)

            const seoComp = result.contentTypes[0].components.find(
                c => c.name === 'seo',
            )
            expect(seoComp).toBeDefined()
            expect(seoComp!.component).toBe('shared.seo')
            expect(seoComp!.componentType).toBe('SharedSeo')
            expect(seoComp!.repeatable).toBe(false)

            const featuresComp = result.contentTypes[0].components.find(
                c => c.name === 'features',
            )
            expect(featuresComp).toBeDefined()
            expect(featuresComp!.repeatable).toBe(true)
            expect(featuresComp!.required).toBe(true)
        })

        it('should transform dynamic zones', () => {
            const extracted: ExtractedSchema = {
                contentTypes: {
                    'api::page.page': {
                        uid: 'api::page.page',
                        kind: 'collectionType',
                        collectionName: 'pages',
                        info: {
                            singularName: 'page',
                            pluralName: 'pages',
                            displayName: 'Page',
                        },
                        attributes: {
                            content: {
                                type: 'dynamiczone',
                                components: [
                                    'blocks.hero',
                                    'blocks.text',
                                    'blocks.gallery',
                                ],
                            },
                        },
                    },
                },
                components: {},
            }

            const result = transformSchema(extracted)

            expect(result.contentTypes[0].dynamicZones).toHaveLength(1)

            const contentDz = result.contentTypes[0].dynamicZones[0]
            expect(contentDz.name).toBe('content')
            expect(contentDz.components).toEqual([
                'blocks.hero',
                'blocks.text',
                'blocks.gallery',
            ])
            expect(contentDz.componentTypes).toEqual([
                'BlocksHero',
                'BlocksText',
                'BlocksGallery',
            ])
        })

        it('should transform enumerations', () => {
            const extracted: ExtractedSchema = {
                contentTypes: {
                    'api::post.post': {
                        uid: 'api::post.post',
                        kind: 'collectionType',
                        collectionName: 'posts',
                        info: {
                            singularName: 'post',
                            pluralName: 'posts',
                            displayName: 'Post',
                        },
                        attributes: {
                            status: {
                                type: 'enumeration',
                                enum: ['draft', 'published', 'archived'],
                                required: true,
                            },
                        },
                    },
                },
                components: {},
            }

            const result = transformSchema(extracted)

            const statusAttr = result.contentTypes[0].attributes.find(
                a => a.name === 'status',
            )
            expect(statusAttr).toBeDefined()
            expect(statusAttr!.type.kind).toBe('enumeration')
            if (statusAttr!.type.kind === 'enumeration') {
                expect(statusAttr!.type.values).toEqual([
                    'draft',
                    'published',
                    'archived',
                ])
            }
        })

        it('should transform components', () => {
            const extracted: ExtractedSchema = {
                contentTypes: {},
                components: {
                    'shared.seo': {
                        uid: 'shared.seo',
                        category: 'shared',
                        info: {
                            displayName: 'SEO',
                        },
                        attributes: {
                            title: { type: 'string', required: true },
                            description: { type: 'text' },
                            keywords: { type: 'string' },
                        },
                    },
                    'landing.hero': {
                        uid: 'landing.hero',
                        category: 'landing',
                        info: {
                            displayName: 'Hero',
                        },
                        attributes: {
                            heading: { type: 'string', required: true },
                            subheading: { type: 'text' },
                            background: { type: 'media', multiple: false },
                        },
                    },
                },
            }

            const result = transformSchema(extracted)

            expect(result.components).toHaveLength(2)

            const seoComp = result.components.find(
                c => c.cleanName === 'SharedSeo',
            )
            expect(seoComp).toBeDefined()
            expect(seoComp!.category).toBe('shared')
            expect(seoComp!.uid).toBe('shared.seo')
            expect(seoComp!.attributes).toHaveLength(3)

            const heroComp = result.components.find(
                c => c.cleanName === 'LandingHero',
            )
            expect(heroComp).toBeDefined()
            expect(heroComp!.category).toBe('landing')
            expect(heroComp!.uid).toBe('landing.hero')
            expect(heroComp!.media).toHaveLength(1)
        })

        it('should transform all scalar types correctly', () => {
            const extracted: ExtractedSchema = {
                contentTypes: {
                    'api::test.test': {
                        uid: 'api::test.test',
                        kind: 'collectionType',
                        collectionName: 'tests',
                        info: {
                            singularName: 'test',
                            pluralName: 'tests',
                            displayName: 'Test',
                        },
                        attributes: {
                            stringField: { type: 'string' },
                            textField: { type: 'text' },
                            richtextField: { type: 'richtext' },
                            blocksField: { type: 'blocks' },
                            emailField: { type: 'email' },
                            passwordField: { type: 'password' },
                            uidField: { type: 'uid' },
                            integerField: { type: 'integer' },
                            bigintegerField: { type: 'biginteger' },
                            floatField: { type: 'float' },
                            decimalField: { type: 'decimal' },
                            booleanField: { type: 'boolean' },
                            dateField: { type: 'date' },
                            timeField: { type: 'time' },
                            datetimeField: { type: 'datetime' },
                            timestampField: { type: 'timestamp' },
                            jsonField: { type: 'json' },
                        },
                    },
                },
                components: {},
            }

            const result = transformSchema(extracted)

            const attrs = result.contentTypes[0].attributes
            expect(attrs.find(a => a.name === 'stringField')!.type.kind).toBe(
                'string',
            )
            expect(attrs.find(a => a.name === 'textField')!.type.kind).toBe(
                'text',
            )
            expect(attrs.find(a => a.name === 'richtextField')!.type.kind).toBe(
                'richtext',
            )
            expect(attrs.find(a => a.name === 'blocksField')!.type.kind).toBe(
                'blocks',
            )
            expect(attrs.find(a => a.name === 'emailField')!.type.kind).toBe(
                'email',
            )
            expect(attrs.find(a => a.name === 'passwordField')!.type.kind).toBe(
                'string',
            )
            expect(attrs.find(a => a.name === 'uidField')!.type.kind).toBe(
                'string',
            )
            expect(attrs.find(a => a.name === 'integerField')!.type.kind).toBe(
                'integer',
            )
            expect(
                attrs.find(a => a.name === 'bigintegerField')!.type.kind,
            ).toBe('biginteger')
            expect(attrs.find(a => a.name === 'floatField')!.type.kind).toBe(
                'float',
            )
            expect(attrs.find(a => a.name === 'decimalField')!.type.kind).toBe(
                'decimal',
            )
            expect(attrs.find(a => a.name === 'booleanField')!.type.kind).toBe(
                'boolean',
            )
            expect(attrs.find(a => a.name === 'dateField')!.type.kind).toBe(
                'date',
            )
            expect(attrs.find(a => a.name === 'timeField')!.type.kind).toBe(
                'time',
            )
            expect(attrs.find(a => a.name === 'datetimeField')!.type.kind).toBe(
                'datetime',
            )
            expect(
                attrs.find(a => a.name === 'timestampField')!.type.kind,
            ).toBe('datetime')
            expect(attrs.find(a => a.name === 'jsonField')!.type.kind).toBe(
                'json',
            )
        })

        it('should handle kebab-case names correctly', () => {
            const extracted: ExtractedSchema = {
                contentTypes: {
                    'api::guide-type.guide-type': {
                        uid: 'api::guide-type.guide-type',
                        kind: 'collectionType',
                        collectionName: 'guide_types',
                        info: {
                            singularName: 'guide-type',
                            pluralName: 'guide-types',
                            displayName: 'Guide Type',
                        },
                        attributes: {
                            name: { type: 'string' },
                        },
                    },
                },
                components: {},
            }

            const result = transformSchema(extracted)

            expect(result.contentTypes[0].cleanName).toBe('GuideType')
        })
    })
})
