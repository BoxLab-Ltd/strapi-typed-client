import { PLUGIN_ID } from './pluginId'
import { Code } from '@strapi/icons'

export default {
    register(app: any) {
        app.addMenuLink({
            to: `plugins/${PLUGIN_ID}`,
            icon: Code,
            intlLabel: {
                id: `${PLUGIN_ID}.plugin.name`,
                defaultMessage: 'Types',
            },
            Component: () => import('./pages/HomePage'),
            permissions: [],
        })
    },

    bootstrap() {},

    async registerTrads({ locales }: { locales: string[] }) {
        return Promise.all(
            locales.map(async locale => {
                return {
                    data: {
                        [`${PLUGIN_ID}.plugin.name`]: 'Types',
                        [`${PLUGIN_ID}.page.title`]: 'Schema Types',
                        [`${PLUGIN_ID}.page.description`]:
                            'View your Strapi schema and generated TypeScript types',
                    },
                    locale,
                }
            }),
        )
    },
}
