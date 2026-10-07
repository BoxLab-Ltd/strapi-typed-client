// Parsed with the compiler, not regexes: multi-line unions, nested keys and comments broke the old scanner

import type * as TS from 'typescript'
import type {
    EndpointType,
    ExtraControllerType,
} from '../../../../shared/endpoint-types.js'

export interface ParsedControllerSource {
    endpoints: Record<string, EndpointType> | null
    extraTypes: ExtraControllerType[]
    syntaxError: boolean
}

const ENDPOINT_KEYS = ['body', 'response', 'params', 'query'] as const

export function parseControllerSource(
    ts: typeof TS,
    source: string,
    controller: string,
    fileName = 'controller.ts',
): ParsedControllerSource {
    const sf = ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true,
        fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    // A file that does not parse would print as partial garbage
    const diagnostics = (sf as { parseDiagnostics?: unknown[] })
        .parseDiagnostics
    if (diagnostics && diagnostics.length > 0) {
        return { endpoints: null, extraTypes: [], syntaxError: true }
    }

    const printer = ts.createPrinter({ removeComments: true })
    const print = (node: TS.TypeNode): string =>
        printer
            .printNode(ts.EmitHint.Unspecified, toPortable(ts, node), sf)
            .trim()

    const endpointMembers: TS.TypeElement[] = []
    const extraTypes: ExtraControllerType[] = []

    for (const statement of sf.statements) {
        if (!isExported(ts, statement)) continue

        if (ts.isInterfaceDeclaration(statement)) {
            if (statement.name.text === 'Endpoints') {
                endpointMembers.push(...statement.members)
                continue
            }
            // The wire format has no slot for type parameters
            if (statement.typeParameters) continue
            const body = print(
                ts.factory.createTypeLiteralNode(statement.members),
            )
            const bases = (statement.heritageClauses ?? []).flatMap(clause =>
                clause.types.map(t =>
                    printer.printNode(ts.EmitHint.Unspecified, t, sf),
                ),
            )
            extraTypes.push({
                controller,
                typeName: statement.name.text,
                typeDefinition: [...bases, body].join(' & '),
            })
        } else if (ts.isTypeAliasDeclaration(statement)) {
            if (statement.name.text === 'Endpoints') {
                endpointMembers.push(...typeLiteralMembers(ts, statement.type))
                continue
            }
            if (statement.typeParameters) continue
            extraTypes.push({
                controller,
                typeName: statement.name.text,
                typeDefinition: print(statement.type),
            })
        }
    }

    const endpoints: Record<string, EndpointType> = {}
    for (const member of endpointMembers) {
        if (!ts.isPropertySignature(member) || !member.type) continue
        const action = memberName(ts, member.name)
        if (action === undefined) continue

        const types: EndpointType = {}
        for (const field of typeLiteralMembers(ts, member.type)) {
            if (!ts.isPropertySignature(field) || !field.type) continue
            const key = memberName(ts, field.name)
            if (key && (ENDPOINT_KEYS as readonly string[]).includes(key)) {
                types[key as keyof EndpointType] = print(field.type)
            }
        }
        // Later declarations of an action win, as with declaration merging
        if (Object.keys(types).length > 0) endpoints[action] = types
    }

    return {
        endpoints: Object.keys(endpoints).length > 0 ? endpoints : null,
        extraTypes,
        syntaxError: false,
    }
}

function isExported(ts: typeof TS, node: TS.Statement): boolean {
    return (
        ts.canHaveModifiers(node) &&
        (ts.getModifiers(node) ?? []).some(
            m => m.kind === ts.SyntaxKind.ExportKeyword,
        )
    )
}

function typeLiteralMembers(
    ts: typeof TS,
    node: TS.TypeNode,
): readonly TS.TypeElement[] {
    if (ts.isTypeLiteralNode(node)) return node.members
    if (ts.isParenthesizedTypeNode(node))
        return typeLiteralMembers(ts, node.type)
    if (ts.isIntersectionTypeNode(node)) {
        return node.types.flatMap(t => typeLiteralMembers(ts, t))
    }
    return []
}

function memberName(ts: typeof TS, name: TS.PropertyName): string | undefined {
    if (
        ts.isIdentifier(name) ||
        ts.isStringLiteral(name) ||
        ts.isNumericLiteral(name)
    ) {
        return name.text
    }
    return undefined
}

// `typeof x`, `import('x')` and `this` can never resolve in the generated client
function toPortable(ts: typeof TS, node: TS.TypeNode): TS.TypeNode {
    const result = ts.transform(node, [
        context => {
            const visit = (child: TS.Node): TS.Node => {
                if (
                    ts.isTypeQueryNode(child) ||
                    ts.isImportTypeNode(child) ||
                    ts.isThisTypeNode(child)
                ) {
                    return ts.factory.createKeywordTypeNode(
                        ts.SyntaxKind.UnknownKeyword,
                    )
                }
                const visited = ts.visitEachChild(child, visit, context)
                // One line on the wire, without touching text inside literals
                if (
                    ts.isTypeLiteralNode(visited) ||
                    ts.isMappedTypeNode(visited) ||
                    ts.isTupleTypeNode(visited)
                ) {
                    ts.setEmitFlags(visited, ts.EmitFlags.SingleLine)
                }
                return visited
            }
            return root => visit(root) as TS.TypeNode
        },
    ])
    // Not disposed: that would drop the emit flags before printing
    const [portable] = result.transformed
    return portable ?? node
}
