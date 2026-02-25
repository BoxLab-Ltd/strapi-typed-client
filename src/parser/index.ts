import * as ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'
import {
    ParsedSchema,
    ContentType,
    Component,
    Attribute,
    AttributeType,
} from '../schema-types.js'
import { convertComponentName, toPascalCase } from '../shared/index.js'
import { PRIVATE_FIELDS } from '../shared/constants.js'

export class StrapiTypeParser {
    private inputDir: string

    constructor(inputDir: string) {
        this.inputDir = inputDir
    }

    parse(): ParsedSchema {
        const contentTypesPath = path.join(this.inputDir, 'contentTypes.d.ts')
        const componentsPath = path.join(this.inputDir, 'components.d.ts')

        const contentTypes = this.parseContentTypes(contentTypesPath)
        const components = this.parseComponents(componentsPath)

        return { contentTypes, components }
    }

    private parseContentTypes(filePath: string): ContentType[] {
        const sourceFile = ts.createSourceFile(
            filePath,
            fs.readFileSync(filePath, 'utf-8'),
            ts.ScriptTarget.Latest,
            true,
        )

        const contentTypes: ContentType[] = []

        ts.forEachChild(sourceFile, node => {
            if (ts.isInterfaceDeclaration(node) && node.name) {
                const interfaceName = node.name.text

                // Parse API types and users-permissions plugin types (User, Role)
                // Skip all other Plugin types (system models we can't interact with)
                const isUsersPermissionsType =
                    interfaceName === 'PluginUsersPermissionsUser' ||
                    interfaceName === 'PluginUsersPermissionsRole'

                if (
                    !interfaceName.startsWith('Api') &&
                    !isUsersPermissionsType
                ) {
                    return
                }

                const contentType = this.parseContentType(node, interfaceName)
                if (contentType) {
                    contentTypes.push(contentType)
                }
            }
        })

        return contentTypes
    }

    private parseComponents(filePath: string): Component[] {
        const sourceFile = ts.createSourceFile(
            filePath,
            fs.readFileSync(filePath, 'utf-8'),
            ts.ScriptTarget.Latest,
            true,
        )

        const components: Component[] = []

        ts.forEachChild(sourceFile, node => {
            if (ts.isInterfaceDeclaration(node) && node.name) {
                const interfaceName = node.name.text

                // Skip the ComponentSchemas declaration
                if (interfaceName === 'ComponentSchemas') {
                    return
                }

                const component = this.parseComponent(node, interfaceName)
                if (component) {
                    components.push(component)
                }
            }
        })

        return components
    }

    private parseContentType(
        node: ts.InterfaceDeclaration,
        interfaceName: string,
    ): ContentType | null {
        let collectionName = ''
        let kind: 'collection' | 'single' = 'collection'
        const attributes: Attribute[] = []
        const relations: any[] = []
        const media: any[] = []
        const components: any[] = []
        const dynamicZones: any[] = []

        // Find the heritage clause to determine kind
        if (node.heritageClauses) {
            for (const clause of node.heritageClauses) {
                for (const type of clause.types) {
                    const typeText = type.expression.getText()
                    if (typeText.includes('SingleTypeSchema')) {
                        kind = 'single'
                    }
                }
            }
        }

        // Parse members
        for (const member of node.members) {
            if (ts.isPropertySignature(member) && member.name) {
                const memberName = member.name.getText()

                if (memberName === 'collectionName' && member.type) {
                    collectionName = this.extractStringLiteral(member.type)
                }

                if (
                    memberName === 'attributes' &&
                    member.type &&
                    ts.isTypeLiteralNode(member.type)
                ) {
                    for (const attr of member.type.members) {
                        const parsed = this.parseAttributeOrRelation(attr)
                        if (parsed) {
                            if (parsed.type === 'relation') {
                                relations.push(parsed.data)
                            } else if (parsed.type === 'media') {
                                media.push(parsed.data)
                            } else if (parsed.type === 'component') {
                                components.push(parsed.data)
                            } else if (parsed.type === 'dynamiczone') {
                                dynamicZones.push(parsed.data)
                            } else {
                                attributes.push(parsed.data)
                            }
                        }
                    }
                }
            }
        }

        // Generate clean name from interface name
        // ApiItemItem -> Item
        const cleanName = this.extractCleanName(interfaceName)

        // Detect plugin content types
        const pluginName = interfaceName.startsWith('PluginUsersPermissions')
            ? 'users-permissions'
            : undefined

        return {
            name: interfaceName,
            cleanName,
            collectionName,
            kind,
            pluginName,
            attributes,
            relations,
            media,
            components,
            dynamicZones,
        }
    }

    private parseComponent(
        node: ts.InterfaceDeclaration,
        interfaceName: string,
    ): Component | null {
        const attributes: Attribute[] = []
        const relations: any[] = []
        const media: any[] = []
        const components: any[] = []
        const dynamicZones: any[] = []

        // Parse members
        for (const member of node.members) {
            if (
                ts.isPropertySignature(member) &&
                member.name &&
                member.name.getText() === 'attributes' &&
                member.type &&
                ts.isTypeLiteralNode(member.type)
            ) {
                for (const attr of member.type.members) {
                    const parsed = this.parseAttributeOrRelation(attr)
                    if (parsed) {
                        if (parsed.type === 'relation') {
                            relations.push(parsed.data)
                        } else if (parsed.type === 'media') {
                            media.push(parsed.data)
                        } else if (parsed.type === 'component') {
                            components.push(parsed.data)
                        } else if (parsed.type === 'dynamiczone') {
                            dynamicZones.push(parsed.data)
                        } else {
                            attributes.push(parsed.data)
                        }
                    }
                }
            }
        }

        // Extract category from name (e.g., LandingEditorFeature -> "landing")
        const category = this.extractComponentCategory(interfaceName)

        return {
            name: interfaceName,
            cleanName: interfaceName,
            category,
            attributes,
            relations,
            media,
            components,
            dynamicZones,
        }
    }

    private parseAttributeOrRelation(
        member: ts.TypeElement,
    ):
        | { type: 'attribute'; data: Attribute }
        | { type: 'relation'; data: any }
        | { type: 'media'; data: any }
        | { type: 'component'; data: any }
        | { type: 'dynamiczone'; data: any }
        | null {
        if (!ts.isPropertySignature(member) || !member.name) {
            return null
        }

        const attrName = member.name.getText()

        // Skip system fields
        const systemFields = ['createdAt', 'updatedAt', ...PRIVATE_FIELDS]
        if (systemFields.includes(attrName)) {
            return null
        }

        if (!member.type) {
            return null
        }

        const typeInfo = this.parseAttributeType(member.type)
        if (!typeInfo) {
            return null
        }

        // Check if Private
        if (this.isPrivateAttribute(member.type)) {
            return null
        }

        const required = this.isRequiredAttribute(member.type)

        // If it's a relation, return as relation
        if (typeInfo.kind === 'relation') {
            // Skip system relations (admin:: and plugin:: except users-permissions entities)
            const target = typeInfo.target
            // Allow plugin::users-permissions.user and plugin::users-permissions.role
            const isAllowedPluginRelation =
                target === 'plugin::users-permissions.user' ||
                target === 'plugin::users-permissions.role'

            if (
                target.startsWith('admin::') ||
                (target.startsWith('plugin::') && !isAllowedPluginRelation)
            ) {
                return null
            }

            const targetType = this.extractTargetTypeName(typeInfo.target)
            return {
                type: 'relation',
                data: {
                    name: attrName,
                    relationType: typeInfo.relationType,
                    target: typeInfo.target,
                    targetType,
                    required,
                },
            }
        }

        // If it's media, return as media
        if (typeInfo.kind === 'media') {
            return {
                type: 'media',
                data: {
                    name: attrName,
                    multiple: typeInfo.multiple || false,
                    required,
                },
            }
        }

        // If it's component, return as component
        if (typeInfo.kind === 'component') {
            const componentType = convertComponentName(typeInfo.component)
            return {
                type: 'component',
                data: {
                    name: attrName,
                    component: typeInfo.component,
                    componentType,
                    repeatable: typeInfo.repeatable || false,
                    required,
                },
            }
        }

        // If it's dynamiczone, return as dynamiczone
        if (typeInfo.kind === 'dynamiczone') {
            const componentTypes = typeInfo.components.map(c =>
                convertComponentName(c),
            )
            return {
                type: 'dynamiczone',
                data: {
                    name: attrName,
                    components: typeInfo.components,
                    componentTypes,
                    required,
                },
            }
        }

        // Otherwise return as attribute
        return {
            type: 'attribute',
            data: {
                name: attrName,
                type: typeInfo,
                required,
            },
        }
    }

    private parseAttributeType(typeNode: ts.TypeNode): AttributeType | null {
        const typeText = typeNode.getText().replace(/\s+/g, ' ')

        // DynamicZone (check first as it's most specific)
        if (typeText.includes('Schema.Attribute.DynamicZone')) {
            const dynamicZoneInfo = this.extractDynamicZoneInfo(typeText)
            if (dynamicZoneInfo) {
                return dynamicZoneInfo
            }
        }

        // Component
        if (typeText.includes('Schema.Attribute.Component')) {
            const componentInfo = this.extractComponentInfo(typeText)
            if (componentInfo) {
                return componentInfo
            }
        }

        // Relation
        if (typeText.includes('Schema.Attribute.Relation')) {
            const relation = this.extractRelationInfo(typeText)
            if (relation) {
                return relation
            }
        }

        // Media
        if (typeText.includes('Schema.Attribute.Media')) {
            // Check if it's multiple: Media<'images', true>
            const mediaMatch = typeText.match(/Media<[^,]+,\s*true/)
            return { kind: 'media', multiple: !!mediaMatch }
        }

        // Enumeration
        if (typeText.includes('Schema.Attribute.Enumeration')) {
            const values = this.extractEnumValues(typeText)
            return { kind: 'enumeration', values }
        }

        // Simple types
        if (typeText.includes('Schema.Attribute.String'))
            return { kind: 'string' }
        if (typeText.includes('Schema.Attribute.Text')) return { kind: 'text' }
        if (typeText.includes('Schema.Attribute.RichText'))
            return { kind: 'richtext' }
        if (typeText.includes('Schema.Attribute.Blocks'))
            return { kind: 'blocks' }
        if (typeText.includes('Schema.Attribute.Email'))
            return { kind: 'email' }
        if (typeText.includes('Schema.Attribute.Integer'))
            return { kind: 'integer' }
        if (typeText.includes('Schema.Attribute.BigInteger'))
            return { kind: 'biginteger' }
        if (typeText.includes('Schema.Attribute.Float'))
            return { kind: 'float' }
        if (typeText.includes('Schema.Attribute.Decimal'))
            return { kind: 'decimal' }
        if (typeText.includes('Schema.Attribute.Boolean'))
            return { kind: 'boolean' }
        if (
            typeText.includes('Schema.Attribute.Date') &&
            !typeText.includes('DateTime')
        )
            return { kind: 'date' }
        if (typeText.includes('Schema.Attribute.DateTime'))
            return { kind: 'datetime' }
        if (typeText.includes('Schema.Attribute.Time')) return { kind: 'time' }
        if (typeText.includes('Schema.Attribute.JSON')) return { kind: 'json' }

        return null
    }

    private isPrivateAttribute(typeNode: ts.TypeNode): boolean {
        return typeNode.getText().includes('Schema.Attribute.Private')
    }

    private isRequiredAttribute(typeNode: ts.TypeNode): boolean {
        return typeNode.getText().includes('Schema.Attribute.Required')
    }

    private extractStringLiteral(typeNode: ts.TypeNode): string {
        if (
            ts.isLiteralTypeNode(typeNode) &&
            ts.isStringLiteral(typeNode.literal)
        ) {
            return typeNode.literal.text
        }
        return ''
    }

    private extractEnumValues(typeText: string): string[] {
        // Extract from Schema.Attribute.Enumeration<['value1', 'value2']>
        // Handle optional whitespace: Enumeration< [ ... ] >
        const match = typeText.match(/Enumeration<\s*\[(.*?)\]\s*>/)
        if (match) {
            return match[1]
                .split(',')
                .map(v => v.trim().replace(/['"]/g, ''))
                .filter(Boolean)
        }
        return []
    }

    private extractRelationInfo(typeText: string): AttributeType | null {
        // Extract from Schema.Attribute.Relation<'oneToOne', 'api::item.item'>
        // Note: Some Strapi schemas have spaces after < : Relation< 'manyToOne', '...' >
        const match = typeText.match(/Relation<\s*'(\w+)',\s*'([^']+)'/)
        if (match) {
            const relationType = match[1] as any
            const target = match[2]
            return {
                kind: 'relation',
                relationType,
                target,
            }
        }
        return null
    }

    private extractComponentInfo(typeText: string): AttributeType | null {
        // Extract from Schema.Attribute.Component<'shared.feature', true>
        // Also handles cases with decorators like SetMinMax after
        // Handle both single line and multiline formats
        const match = typeText.match(
            /Component<\s*'([^']+)'\s*(?:,\s*(true|false))?\s*>/,
        )
        if (match) {
            const component = match[1]
            const repeatable = match[2] === 'true'
            return {
                kind: 'component',
                component,
                repeatable,
            }
        }
        return null
    }

    private extractDynamicZoneInfo(typeText: string): AttributeType | null {
        // Extract from Schema.Attribute.DynamicZone<['shared.feature', 'landing.editor-feature']>
        // Handle both single line and multiline formats
        const match = typeText.match(/DynamicZone<\s*\[(.*?)\]\s*>/)
        if (match) {
            const componentsStr = match[1]
            // Extract component names from the array: 'shared.feature', 'landing.editor-feature'
            const components = componentsStr
                .split(',')
                .map(c => c.trim().replace(/['"]/g, ''))
                .filter(Boolean)

            return {
                kind: 'dynamiczone',
                components,
            }
        }
        return null
    }

    private extractCleanName(interfaceName: string): string {
        // Handle Plugin types
        if (interfaceName === 'PluginUsersPermissionsUser') {
            return 'User'
        }
        if (interfaceName === 'PluginUsersPermissionsRole') {
            return 'Role'
        }

        // Handle API types: ApiItemItem -> Item, ApiAuthAuth -> Auth
        const withoutApi = interfaceName.replace(/^Api/, '')

        // Find the repeated part
        const half = Math.ceil(withoutApi.length / 2)
        for (let i = half; i > 0; i--) {
            const first = withoutApi.substring(0, i)
            const second = withoutApi.substring(i, i * 2)
            if (first === second) {
                return first
            }
        }

        return withoutApi
    }

    private extractComponentCategory(componentName: string): string {
        // LandingEditorFeature -> "landing"
        // SharedFeature -> "shared"
        const match = componentName.match(/^([A-Z][a-z]+)/)
        return match ? match[1].toLowerCase() : ''
    }

    private extractTargetTypeName(target: string): string {
        // Extract clean type name from target
        // "api::item.item" -> "Item"
        // "api::guide-type.guide-type" -> "GuideType"
        // "plugin::users-permissions.user" -> "User"
        const parts = target.split('::')
        if (parts.length === 2) {
            const [prefix, rest] = parts
            const name = rest.split('.').pop() || rest

            // Handle plugin types specially
            if (prefix === 'plugin') {
                if (target === 'plugin::users-permissions.user') {
                    return 'User'
                }
                if (target === 'plugin::users-permissions.role') {
                    return 'Role'
                }
            }

            // Convert kebab-case to PascalCase: guide-type -> GuideType
            return toPascalCase(name)
        }
        return target
    }
}
