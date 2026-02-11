import { AttributeType } from '../schema-types.js'
import { convertComponentName, toEndpointName } from '../shared/index.js'

export class TypeTransformer {
    /**
     * Converts Strapi attribute type to TypeScript type string
     */
    toTypeScript(attrType: AttributeType, required: boolean): string {
        let tsType = this.getBaseType(attrType)

        if (!required && !this.isAlwaysRequired(attrType)) {
            tsType += ' | null'
        }

        return tsType
    }

    private getBaseType(attrType: AttributeType): string {
        switch (attrType.kind) {
            case 'string':
            case 'text':
            case 'richtext':
            case 'email':
                return 'string'

            case 'blocks':
                return 'BlocksContent'

            case 'integer':
            case 'biginteger':
            case 'float':
            case 'decimal':
                return 'number'

            case 'boolean':
                return 'boolean'

            case 'date':
            case 'datetime':
            case 'time':
                return 'string'

            case 'json':
                return 'unknown'

            case 'enumeration':
                return attrType.values.map(v => `'${v}'`).join(' | ')

            case 'media':
                return attrType.multiple ? 'MediaFile[]' : 'MediaFile'

            case 'component': {
                const componentType = convertComponentName(attrType.component)
                return attrType.repeatable
                    ? `${componentType}[]`
                    : componentType
            }

            case 'dynamiczone': {
                const components = attrType.components.map(c =>
                    convertComponentName(c),
                )
                return `(${components.join(' | ')})[]`
            }

            case 'relation':
                return this.getRelationType(attrType.relationType)

            default:
                return 'any'
        }
    }

    private getRelationType(relationType: string): string {
        switch (relationType) {
            case 'oneToOne':
            case 'manyToOne':
                return '{ id: number; documentId: string } | null'

            case 'oneToMany':
            case 'manyToMany':
                return '{ id: number; documentId: string }[]'

            default:
                return 'any'
        }
    }

    private isAlwaysRequired(attrType: AttributeType): boolean {
        // Relations already have null in their type definition
        if (attrType.kind === 'relation') {
            return true
        }
        return false
    }

    /**
     * Converts API type to collection endpoint name
     * ApiItemItem -> 'items'
     * ApiCatalogCatalog -> 'catalog' (if single type)
     */
    toEndpointName(cleanName: string, isSingle: boolean): string {
        return toEndpointName(cleanName, isSingle)
    }
}
