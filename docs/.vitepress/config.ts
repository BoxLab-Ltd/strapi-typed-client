import { defineConfig } from 'vitepress'

export default defineConfig({
    title: 'strapi-typed-client',
    description:
        'Type-safe Strapi v5 client with automatic TypeScript codegen and populate type inference',
    base: '/strapi-typed-client/',

    head: [
        [
            'link',
            {
                rel: 'icon',
                type: 'image/svg+xml',
                href: '/strapi-typed-client/logo.svg',
            },
        ],
    ],

    themeConfig: {
        nav: [
            { text: 'Guide', link: '/guide/getting-started' },
            { text: 'Advanced', link: '/advanced/dynamic-zones' },
            { text: 'Reference', link: '/reference/type-mapping' },
        ],

        sidebar: {
            '/guide/': [
                {
                    text: 'Guide',
                    items: [
                        {
                            text: 'Getting Started',
                            link: '/guide/getting-started',
                        },
                        { text: 'CLI Commands', link: '/guide/cli' },
                        { text: 'Client Usage', link: '/guide/client' },
                        { text: 'Populate', link: '/guide/populate' },
                        {
                            text: 'Filtering & Sorting',
                            link: '/guide/filtering',
                        },
                        { text: 'Input Types', link: '/guide/input-types' },
                        {
                            text: 'Next.js Integration',
                            link: '/guide/nextjs',
                        },
                    ],
                },
            ],
            '/advanced/': [
                {
                    text: 'Advanced',
                    items: [
                        {
                            text: 'Dynamic Zones',
                            link: '/advanced/dynamic-zones',
                        },
                        {
                            text: 'Single Types',
                            link: '/advanced/single-types',
                        },
                        {
                            text: 'Authentication',
                            link: '/advanced/authentication',
                        },
                        {
                            text: 'Custom Endpoints',
                            link: '/advanced/custom-endpoints',
                        },
                        {
                            text: 'Plugin Config',
                            link: '/advanced/plugin-config',
                        },
                    ],
                },
            ],
            '/reference/': [
                {
                    text: 'Reference',
                    items: [
                        {
                            text: 'Type Mapping',
                            link: '/reference/type-mapping',
                        },
                        {
                            text: 'Generated Types',
                            link: '/reference/generated-types',
                        },
                        {
                            text: 'Media & Blocks',
                            link: '/reference/media-file',
                        },
                        { text: 'API Reference', link: '/reference/api' },
                    ],
                },
            ],
        },

        socialLinks: [
            {
                icon: 'github',
                link: 'https://github.com/BoxLab-Ltd/strapi-typed-client',
            },
        ],

        search: {
            provider: 'local',
        },

        editLink: {
            pattern:
                'https://github.com/BoxLab-Ltd/strapi-typed-client/edit/main/docs/:path',
            text: 'Edit this page on GitHub',
        },

        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Copyright © BoxLab Ltd',
        },
    },
})
