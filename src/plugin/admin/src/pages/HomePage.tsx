import { useState, useEffect } from 'react'
import { PLUGIN_ID } from '../pluginId'
import {
    Main,
    Box,
    Typography,
    Flex,
    Badge,
    Loader,
    Tabs,
} from '@strapi/design-system'
import type { ParsedEndpoint } from '../../../../shared/endpoint-types.js'
import type { SchemaResponse } from '../../../../shared/strapi-schema-types.js'

type SchemaData = SchemaResponse

const METHOD_COLORS: Record<string, { bg: string; text: string }> = {
    GET: { bg: 'primary100', text: 'primary700' },
    POST: { bg: 'success100', text: 'success700' },
    PUT: { bg: 'warning100', text: 'warning700' },
    PATCH: { bg: 'warning100', text: 'warning700' },
    DELETE: { bg: 'danger100', text: 'danger700' },
}

export default function HomePage() {
    const [data, setData] = useState<SchemaData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
    const [expandedEndpoints, setExpandedEndpoints] = useState<Set<string>>(
        new Set(),
    )

    useEffect(() => {
        fetch(`/api/${PLUGIN_ID}/schema`)
            .then(res => res.json())
            .then(json => {
                setData(json)
                setLoading(false)
            })
            .catch(err => {
                setError(err.message)
                setLoading(false)
            })
    }, [])

    const toggleItem = (uid: string) => {
        setExpandedItems(prev => {
            const next = new Set(prev)
            if (next.has(uid)) {
                next.delete(uid)
            } else {
                next.add(uid)
            }
            return next
        })
    }

    const toggleEndpoint = (key: string) => {
        setExpandedEndpoints(prev => {
            const next = new Set(prev)
            if (next.has(key)) {
                next.delete(key)
            } else {
                next.add(key)
            }
            return next
        })
    }

    if (loading) {
        return (
            <Main>
                <Box padding={8}>
                    <Flex justifyContent='center'>
                        <Loader>Loading schema...</Loader>
                    </Flex>
                </Box>
            </Main>
        )
    }

    if (error || !data) {
        return (
            <Main>
                <Box padding={8}>
                    <Typography textColor='danger600'>
                        {error || 'No schema data available'}
                    </Typography>
                </Box>
            </Main>
        )
    }

    // Filter out plugin types except User - Permission/Role not needed for frontend
    const contentTypes = Object.values(data.schema.contentTypes).filter(
        (ct: any) =>
            !ct.uid.startsWith('plugin::') ||
            ct.uid === 'plugin::users-permissions.user',
    )
    const components = Object.values(data.schema.components)
    const endpoints = data.endpoints || []

    return (
        <Main>
            <Box
                paddingTop={6}
                paddingBottom={6}
                paddingLeft={4}
                paddingRight={4}
                background='neutral100'
            >
                <Box paddingBottom={4}>
                    <Typography variant='alpha' tag='h1'>
                        Schema Types
                    </Typography>
                    <Box paddingTop={1}>
                        <Typography variant='epsilon' textColor='neutral600'>
                            View your Strapi schema for TypeScript type
                            generation
                        </Typography>
                    </Box>
                </Box>

                {/* Hash info */}
                <Box
                    padding={4}
                    background='neutral0'
                    hasRadius
                    shadow='filterShadow'
                    marginBottom={6}
                >
                    <Flex gap={4} wrap='wrap'>
                        <Box style={{ minWidth: 0, flex: '1 1 100%' }}>
                            <Typography variant='sigma' textColor='neutral600'>
                                Schema Hash
                            </Typography>
                            <Box paddingTop={1}>
                                <Typography
                                    variant='omega'
                                    style={{
                                        fontFamily: 'monospace',
                                        fontSize: '12px',
                                        wordBreak: 'break-all',
                                    }}
                                >
                                    {data.hash}
                                </Typography>
                            </Box>
                        </Box>
                        <Box style={{ minWidth: 0 }}>
                            <Typography variant='sigma' textColor='neutral600'>
                                Generated
                            </Typography>
                            <Box paddingTop={1}>
                                <Typography variant='omega'>
                                    {new Date(
                                        data.generatedAt,
                                    ).toLocaleString()}
                                </Typography>
                            </Box>
                        </Box>
                        <Box>
                            <Typography variant='sigma' textColor='neutral600'>
                                Content Types
                            </Typography>
                            <Box paddingTop={1}>
                                <Typography variant='omega' fontWeight='bold'>
                                    {contentTypes.length}
                                </Typography>
                            </Box>
                        </Box>
                        <Box>
                            <Typography variant='sigma' textColor='neutral600'>
                                Components
                            </Typography>
                            <Box paddingTop={1}>
                                <Typography variant='omega' fontWeight='bold'>
                                    {components.length}
                                </Typography>
                            </Box>
                        </Box>
                        <Box>
                            <Typography variant='sigma' textColor='neutral600'>
                                Endpoints
                            </Typography>
                            <Box paddingTop={1}>
                                <Typography variant='omega' fontWeight='bold'>
                                    {endpoints.length}
                                </Typography>
                            </Box>
                        </Box>
                    </Flex>
                </Box>

                {/* Tabs */}
                <Tabs.Root defaultValue='contentTypes'>
                    <Tabs.List>
                        <Tabs.Trigger value='contentTypes'>
                            Content Types ({contentTypes.length})
                        </Tabs.Trigger>
                        <Tabs.Trigger value='components'>
                            Components ({components.length})
                        </Tabs.Trigger>
                        <Tabs.Trigger value='endpoints'>
                            Endpoints ({endpoints.length})
                        </Tabs.Trigger>
                    </Tabs.List>

                    <Box paddingTop={4}>
                        <Tabs.Content value='contentTypes'>
                            <Box
                                background='neutral100'
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '16px',
                                }}
                            >
                                {contentTypes.map((ct: any) => (
                                    <SchemaItem
                                        key={ct.uid}
                                        item={ct}
                                        isExpanded={expandedItems.has(ct.uid)}
                                        onToggle={() => toggleItem(ct.uid)}
                                    />
                                ))}
                            </Box>
                        </Tabs.Content>
                        <Tabs.Content value='components'>
                            <Box
                                background='neutral100'
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '16px',
                                }}
                            >
                                {components.map((comp: any) => (
                                    <SchemaItem
                                        key={comp.uid}
                                        item={comp}
                                        isExpanded={expandedItems.has(comp.uid)}
                                        onToggle={() => toggleItem(comp.uid)}
                                    />
                                ))}
                            </Box>
                        </Tabs.Content>
                        <Tabs.Content value='endpoints'>
                            <Box
                                background='neutral100'
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '16px',
                                }}
                            >
                                {endpoints.length === 0 ? (
                                    <Box
                                        padding={4}
                                        background='neutral0'
                                        hasRadius
                                    >
                                        <Typography textColor='neutral600'>
                                            No custom endpoints found. Add
                                            routes to your API to see them here.
                                        </Typography>
                                    </Box>
                                ) : (
                                    endpoints.map(endpoint => {
                                        const key = `${endpoint.method}-${endpoint.path}`
                                        return (
                                            <EndpointItem
                                                key={key}
                                                endpoint={endpoint}
                                                isExpanded={expandedEndpoints.has(
                                                    key,
                                                )}
                                                onToggle={() =>
                                                    toggleEndpoint(key)
                                                }
                                            />
                                        )
                                    })
                                )}
                            </Box>
                        </Tabs.Content>
                    </Box>
                </Tabs.Root>
            </Box>
        </Main>
    )
}

function SchemaItem({
    item,
    isExpanded,
    onToggle,
}: {
    item: any
    isExpanded: boolean
    onToggle: () => void
}) {
    const attributes = Object.entries(item.attributes || {})

    return (
        <Box
            background='neutral0'
            hasRadius
            borderColor='neutral200'
            borderStyle='solid'
            borderWidth='1px'
            overflow='hidden'
        >
            <Box
                padding={4}
                background={isExpanded ? 'primary100' : 'neutral0'}
                style={{ cursor: 'pointer', transition: 'background 0.2s' }}
                onClick={onToggle}
            >
                <Flex
                    justifyContent='space-between'
                    alignItems='flex-start'
                    gap={2}
                    wrap='wrap'
                >
                    <Box style={{ minWidth: 0, flex: '1 1 0' }}>
                        <Flex gap={2} alignItems='center' wrap='wrap'>
                            <Typography
                                fontWeight='bold'
                                textColor='neutral800'
                                variant='delta'
                            >
                                {item.info?.displayName ||
                                    item.uid.split('.').pop()}
                            </Typography>
                            <Badge active={isExpanded}>
                                {attributes.length} fields
                            </Badge>
                        </Flex>
                        <Box paddingTop={1}>
                            <Typography
                                variant='pi'
                                textColor='neutral500'
                                style={{
                                    fontFamily: 'monospace',
                                    fontSize: '11px',
                                    wordBreak: 'break-all',
                                }}
                            >
                                {item.uid}
                            </Typography>
                        </Box>
                    </Box>
                    <Typography
                        textColor='neutral500'
                        style={{ flexShrink: 0 }}
                    >
                        {isExpanded ? '▼' : '▶'}
                    </Typography>
                </Flex>
            </Box>

            {isExpanded && (
                <Box
                    background='neutral0'
                    borderColor='neutral200'
                    borderStyle='solid'
                    borderWidth='1px 0 0 0'
                >
                    {/* Header */}
                    <Box
                        background='neutral100'
                        borderColor='neutral200'
                        borderStyle='solid'
                        borderWidth='0 0 1px 0'
                        paddingTop={3}
                        paddingBottom={3}
                        paddingLeft={4}
                        paddingRight={4}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: GRID_COLUMNS,
                            gap: '0 24px',
                        }}
                    >
                        <Typography variant='sigma' textColor='neutral600'>
                            Field
                        </Typography>
                        <Typography variant='sigma' textColor='neutral600'>
                            Type
                        </Typography>
                        <Typography variant='sigma' textColor='neutral600'>
                            Details
                        </Typography>
                    </Box>
                    {/* Rows */}
                    {attributes.map(
                        ([name, attr]: [string, any], i: number) => (
                            <Box
                                key={name}
                                borderColor='neutral150'
                                borderStyle='solid'
                                borderWidth={i > 0 ? '1px 0 0 0' : '0'}
                                paddingTop={3}
                                paddingBottom={3}
                                paddingLeft={4}
                                paddingRight={4}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: GRID_COLUMNS,
                                    gap: '0 24px',
                                    alignItems: 'center',
                                }}
                            >
                                <Typography
                                    textColor='neutral800'
                                    fontWeight='bold'
                                    style={{ wordBreak: 'break-word' }}
                                >
                                    {name}
                                    {attr.required && (
                                        <Typography textColor='danger600'>
                                            {' '}
                                            *
                                        </Typography>
                                    )}
                                </Typography>
                                <Badge>{attr.type}</Badge>
                                <Typography
                                    variant='omega'
                                    textColor='neutral600'
                                    style={{ wordBreak: 'break-word' }}
                                >
                                    {getDetails(attr)}
                                </Typography>
                            </Box>
                        ),
                    )}
                </Box>
            )}
        </Box>
    )
}

interface ParsedField {
    name: string
    type: string
    required: boolean
    details?: string
}

function parseObjectType(typeStr: string): ParsedField[] {
    const fields: ParsedField[] = []

    // Remove outer braces and trim
    let inner = typeStr.trim()
    if (inner.startsWith('{')) {
        inner = inner.slice(1)
    }
    if (inner.endsWith('}')) {
        inner = inner.slice(0, -1)
    }
    inner = inner.trim()

    if (!inner) return fields

    // Split by semicolons or newlines, handling nested braces
    const parts: string[] = []
    let current = ''
    let depth = 0

    for (const char of inner) {
        if (char === '{') depth++
        else if (char === '}') depth--

        if ((char === ';' || char === '\n') && depth === 0) {
            if (current.trim()) {
                parts.push(current.trim())
            }
            current = ''
        } else {
            current += char
        }
    }
    if (current.trim()) {
        parts.push(current.trim())
    }

    for (const part of parts) {
        // Match: fieldName?: type or fieldName: type
        const match = part.match(/^(\w+)(\?)?:\s*(.+)$/)
        if (match) {
            const [, name, optional, type] = match
            const typeValue = type.trim()

            // Determine the type badge
            let typeBadge: string
            let details = ''

            if (typeValue === 'number') {
                typeBadge = 'number'
            } else if (typeValue === 'boolean') {
                typeBadge = 'boolean'
            } else if (typeValue === 'string') {
                typeBadge = 'string'
            } else if (typeValue.startsWith('{')) {
                typeBadge = 'object'
                details = typeValue
            } else if (
                typeValue.startsWith('Array<') ||
                typeValue.startsWith('[') ||
                typeValue.endsWith('[]')
            ) {
                typeBadge = 'array'
                // Extract inner type for Array<...>
                if (typeValue.startsWith('Array<')) {
                    details = typeValue.slice(6, -1) // Remove "Array<" and ">"
                } else {
                    details = typeValue
                }
            } else if (typeValue.includes('|')) {
                typeBadge = 'enumeration'
                details = typeValue
            } else {
                typeBadge = typeValue.toLowerCase()
                if (!['number', 'string', 'boolean'].includes(typeBadge)) {
                    typeBadge = 'object'
                    details = typeValue
                }
            }

            fields.push({
                name,
                type: typeBadge,
                required: !optional,
                details,
            })
        }
    }

    return fields
}

function EndpointItem({
    endpoint,
    isExpanded,
    onToggle,
}: {
    endpoint: ParsedEndpoint
    isExpanded: boolean
    onToggle: () => void
}) {
    const methodColor = METHOD_COLORS[endpoint.method] || {
        bg: 'neutral100',
        text: 'neutral700',
    }
    const hasTypes =
        endpoint.types &&
        (endpoint.types.body ||
            endpoint.types.response ||
            endpoint.types.params ||
            endpoint.types.query)

    // Parse body and response into fields
    const bodyFields =
        endpoint.types?.body && endpoint.types.body !== 'void'
            ? parseObjectType(endpoint.types.body)
            : []

    // Unwrap response.data automatically if present
    let responseFields: ParsedField[] = []
    if (endpoint.types?.response) {
        const parsed = parseObjectType(endpoint.types.response)
        // If response has only one field called 'data', unwrap it
        if (
            parsed.length === 1 &&
            parsed[0].name === 'data' &&
            parsed[0].details
        ) {
            responseFields = parseObjectType(parsed[0].details)
        } else {
            responseFields = parsed
        }
    }

    const totalFields = bodyFields.length + responseFields.length

    return (
        <Box
            background='neutral0'
            hasRadius
            borderColor='neutral200'
            borderStyle='solid'
            borderWidth='1px'
            overflow='hidden'
        >
            <Box
                padding={4}
                background={isExpanded ? 'primary100' : 'neutral0'}
                style={{ cursor: 'pointer', transition: 'background 0.2s' }}
                onClick={onToggle}
            >
                <Flex
                    justifyContent='space-between'
                    alignItems='flex-start'
                    gap={2}
                >
                    <Box style={{ minWidth: 0, flex: '1 1 0' }}>
                        <Flex gap={2} alignItems='center' wrap='wrap'>
                            <Box
                                padding={1}
                                paddingLeft={2}
                                paddingRight={2}
                                background={methodColor.bg}
                                hasRadius
                                style={{ flexShrink: 0 }}
                            >
                                <Typography
                                    fontWeight='bold'
                                    textColor={methodColor.text}
                                    style={{
                                        fontFamily: 'monospace',
                                        fontSize: '12px',
                                    }}
                                >
                                    {endpoint.method}
                                </Typography>
                            </Box>
                            <Typography
                                fontWeight='bold'
                                textColor='neutral800'
                                style={{
                                    fontFamily: 'monospace',
                                    wordBreak: 'break-all',
                                }}
                            >
                                {endpoint.path}
                            </Typography>
                            {hasTypes && (
                                <Badge active>{totalFields} fields</Badge>
                            )}
                        </Flex>
                        <Box paddingTop={1}>
                            <Typography
                                variant='pi'
                                textColor='neutral500'
                                style={{
                                    fontFamily: 'monospace',
                                    fontSize: '11px',
                                    wordBreak: 'break-all',
                                }}
                            >
                                {endpoint.handler}
                            </Typography>
                        </Box>
                    </Box>
                    <Typography
                        textColor='neutral500'
                        style={{ flexShrink: 0 }}
                    >
                        {isExpanded ? '▼' : '▶'}
                    </Typography>
                </Flex>
            </Box>

            {isExpanded && (
                <Box
                    padding={4}
                    background='neutral100'
                    borderColor='neutral200'
                    borderStyle='solid'
                    borderWidth='1px 0 0 0'
                >
                    {hasTypes ? (
                        <Box
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '16px',
                            }}
                        >
                            {bodyFields.length > 0 && (
                                <Box>
                                    <Box paddingBottom={2}>
                                        <Typography
                                            variant='sigma'
                                            textColor='neutral600'
                                        >
                                            Request Body
                                        </Typography>
                                    </Box>
                                    <FieldsList
                                        fields={bodyFields}
                                        showRequired
                                    />
                                </Box>
                            )}

                            {responseFields.length > 0 && (
                                <Box>
                                    <Box paddingBottom={2}>
                                        <Typography
                                            variant='sigma'
                                            textColor='neutral600'
                                        >
                                            Response
                                        </Typography>
                                    </Box>
                                    <FieldsList fields={responseFields} />
                                </Box>
                            )}
                        </Box>
                    ) : (
                        <Typography variant='pi' textColor='neutral500'>
                            No type definitions found. Add an{' '}
                            <Typography
                                style={{ fontFamily: 'monospace' }}
                                textColor='neutral600'
                            >
                                export interface Endpoints
                            </Typography>{' '}
                            to the controller to enable type generation.
                        </Typography>
                    )}
                </Box>
            )}
        </Box>
    )
}

const GRID_COLUMNS = 'minmax(120px, 280px) 130px 1fr'

function FieldsList({
    fields,
    showRequired,
}: {
    fields: ParsedField[]
    showRequired?: boolean
}) {
    return (
        <Box
            background='neutral0'
            hasRadius
            borderColor='neutral200'
            borderStyle='solid'
            borderWidth='1px'
            overflow='hidden'
        >
            {/* Header */}
            <Box
                background='neutral100'
                borderColor='neutral200'
                borderStyle='solid'
                borderWidth='0 0 1px 0'
                paddingTop={3}
                paddingBottom={3}
                paddingLeft={4}
                paddingRight={4}
                style={{
                    display: 'grid',
                    gridTemplateColumns: GRID_COLUMNS,
                    gap: '0 24px',
                }}
            >
                <Typography variant='sigma' textColor='neutral600'>
                    Field
                </Typography>
                <Typography variant='sigma' textColor='neutral600'>
                    Type
                </Typography>
                <Typography variant='sigma' textColor='neutral600'>
                    Details
                </Typography>
            </Box>
            {/* Rows */}
            {fields.map((field, i) => (
                <Box
                    key={field.name}
                    borderColor='neutral150'
                    borderStyle='solid'
                    borderWidth={i > 0 ? '1px 0 0 0' : '0'}
                    paddingTop={3}
                    paddingBottom={3}
                    paddingLeft={4}
                    paddingRight={4}
                    style={{
                        display: 'grid',
                        gridTemplateColumns: GRID_COLUMNS,
                        gap: '0 24px',
                        alignItems: 'center',
                    }}
                >
                    <Typography
                        textColor='neutral800'
                        fontWeight='bold'
                        style={{ wordBreak: 'break-word' }}
                    >
                        {field.name}
                        {showRequired && field.required && (
                            <Typography textColor='danger600'> *</Typography>
                        )}
                    </Typography>
                    <Badge>{field.type}</Badge>
                    <Typography
                        variant='omega'
                        textColor='neutral600'
                        style={{ wordBreak: 'break-word' }}
                    >
                        {field.details || ''}
                    </Typography>
                </Box>
            ))}
        </Box>
    )
}

function getDetails(attr: any): string {
    const details: string[] = []

    if (attr.relation) {
        details.push(`${attr.relation} → ${attr.target}`)
    }
    if (attr.component) {
        details.push(attr.component)
        if (attr.repeatable) details.push('(repeatable)')
    }
    if (attr.components) {
        details.push(attr.components.join(', '))
    }
    if (attr.enum) {
        details.push(attr.enum.join(' | '))
    }
    if (attr.multiple) {
        details.push('multiple')
    }

    return details.join(' ')
}
