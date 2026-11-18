// REST, RPC and the OpenAPI document, under /api
import { toNextHandlers } from '@onedef/orpc'
import { backend } from '@/lib/backend'

export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = toNextHandlers(backend)
