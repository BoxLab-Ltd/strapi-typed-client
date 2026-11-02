import type { ParsedEndpoint } from '../shared/endpoint-types.js'
import {
    extractPathParams,
    toCamelCase,
    toPascalCase,
} from '../shared/string-utils.js'
import { buildMethodParams, buildRequestCall } from './method-signature.js'

/**
 * Content-API routes of third-party plugins (navigation, comments, …), one
 * class per plugin on `client.<plugin>`. users-permissions keeps its own
 * controller-based classes; upload and i18n come from the plugin registry.
 */
export function isOtherPluginEndpoint(endpoint: ParsedEndpoint): boolean {
    return !!endpoint.pluginName && endpoint.pluginName !== 'users-permissions'
}

// A plugin action named like one of these would override BaseAPI's own member
const BASE_API_MEMBERS = new Set([
    'constructor',
    'config',
    'request',
    'parseResponse',
    'buildQueryString',
    'splitWriteArgs',
    'getErrorHint',
])

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

export interface PluginRouteMethod {
    name: string
    endpoint: ParsedEndpoint
}

export interface PluginRoutesApi {
    pluginName: string
    className: string
    propName: string
    methods: PluginRouteMethod[]
}

export class PluginRoutesGenerator {
    /**
     * Group the routes by plugin and settle every name up front, so the class
     * emission and the StrapiClient wiring agree. `takenProps` are the
     * StrapiClient members already spoken for.
     */
    plan(
        endpoints: ParsedEndpoint[],
        takenProps: ReadonlySet<string>,
    ): PluginRoutesApi[] {
        const byPlugin = new Map<string, ParsedEndpoint[]>()
        for (const endpoint of endpoints) {
            // Regex paths such as `/connect/(.*)` have no URL a client can build
            if (!endpoint.pluginName || /[(*]/.test(endpoint.path)) continue
            const list = byPlugin.get(endpoint.pluginName) ?? []
            list.push(endpoint)
            byPlugin.set(endpoint.pluginName, list)
        }

        const props = new Set(takenProps)
        return [...byPlugin.keys()].sort().map(pluginName => {
            const base = toCamelCase(pluginName)
            const propName = props.has(base) ? `${base}Plugin` : base
            props.add(propName)
            return {
                pluginName,
                className: `${toPascalCase(pluginName)}PluginAPI`,
                propName,
                methods: this.nameMethods(byPlugin.get(pluginName)!),
            }
        })
    }

    generateClasses(apis: PluginRoutesApi[]): string {
        if (apis.length === 0) return ''
        const base = `// Plugin routes may answer with XML or plain text (a sitemap, a health check), not only JSON
class PluginRoutesAPI extends BaseAPI {
  protected override parseResponse<R>(response: Response): Promise<R> {
    const type = response.headers.get('content-type') ?? ''
    return (type === '' || /json/i.test(type) ? response.json() : response.text()) as Promise<R>
  }
}`
        return [base, ...apis.map(api => this.generateClass(api))].join('\n\n')
    }

    // Action name when unique in the plugin, else prefixed with its controller
    private nameMethods(endpoints: ParsedEndpoint[]): PluginRouteMethod[] {
        const sorted = [...endpoints].sort(
            (a, b) =>
                a.path.localeCompare(b.path) ||
                a.method.localeCompare(b.method),
        )
        const counts = new Map<string, number>()
        for (const e of sorted) {
            const name = toCamelCase(e.action)
            counts.set(name, (counts.get(name) ?? 0) + 1)
        }
        const used = new Set<string>()
        return sorted.map(endpoint => {
            const action = toCamelCase(endpoint.action)
            let name =
                counts.get(action)! > 1 || BASE_API_MEMBERS.has(action)
                    ? toCamelCase(endpoint.controller) +
                      toPascalCase(endpoint.action)
                    : action
            if (used.has(name) || BASE_API_MEMBERS.has(name)) {
                let n = 2
                while (used.has(`${name}${n}`)) n++
                name = `${name}${n}`
            }
            used.add(name)
            return { name, endpoint }
        })
    }

    private generateClass(api: PluginRoutesApi): string {
        const typeAliases: string[] = []
        const methods = api.methods.map(({ name, endpoint }) => {
            const typeName = toPascalCase(name)
            const types = endpoint.types
            const ref = (suffix: string, type: string | undefined) => {
                if (!type) return undefined
                typeAliases.push(`  export type ${typeName}${suffix} = ${type}`)
                return `${api.className}.${typeName}${suffix}`
            }
            const query = ref('Query', types?.query)
            const body = ref('Body', types?.body)
            const response = ref('Response', types?.response)
            return this.generateMethod(name, endpoint, {
                query,
                body,
                response,
            })
        })

        const namespace =
            typeAliases.length > 0
                ? `\n\nexport namespace ${api.className} {\n${typeAliases.join('\n')}\n}`
                : ''
        return `/** Content-API routes of the \`${api.pluginName}\` plugin. */
export class ${api.className} extends PluginRoutesAPI {
${methods.join('\n\n')}
}${namespace}`
    }

    private generateMethod(
        name: string,
        endpoint: ParsedEndpoint,
        types: { query?: string; body?: string; response?: string },
    ): string {
        const hasBody = BODY_METHODS.has(endpoint.method)
        const responseType = types.response ?? 'T'
        const params = buildMethodParams({
            pathParams: extractPathParams(endpoint.path),
            ...(hasBody && {
                data: types.body
                    ? { type: `${types.body} | FormData`, optional: false }
                    : { type: 'unknown' },
            }),
            query: { type: types.query ?? 'Record<string, unknown>' },
        })
        const path = endpoint.path.replace(
            /:([a-zA-Z_][a-zA-Z0-9_]*)/g,
            '${encodeURIComponent($1)}',
        )
        const init = hasBody
            ? `{ method: '${endpoint.method}', body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data) }`
            : endpoint.method === 'GET'
              ? undefined
              : `{ method: '${endpoint.method}' }`

        return `  /**
   * ${endpoint.method} ${endpoint.path}
   * Handler: ${endpoint.handler}${types.response ? '' : '\n   * Response type is not declared by the plugin — pass it as the type argument.'}
   */
  async ${name}${types.response ? '' : '<T = unknown>'}(${params}): Promise<${responseType}> {
    const url = \`\${this.config.baseURL}/api${path}\${this.buildQueryString(params)}\`
    return ${buildRequestCall({ responseType, ...(init && { init }) })}
  }`
    }
}
