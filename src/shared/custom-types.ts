/**
 * Custom type definition for a specific endpoint
 */
export interface CustomEndpointType {
    handler: string // e.g., 'team-invitation.create'
    inputType?: string // e.g., 'TeamInvitationAPI.CreateRequest'
    outputType?: string // e.g., 'TeamInvitationAPI.CreateResponse'
}

/**
 * Parsed custom types from API namespace files
 */
export interface ParsedCustomTypes {
    types: Map<string, CustomEndpointType> // key: handler (e.g., 'team-invitation.create')
    typeDefinitions: string[] // raw namespace definitions to include in generated file
    namespaceImports: string[] // list of namespace names to import
}
