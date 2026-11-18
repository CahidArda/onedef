// Server side: host a backend over oRPC (RPC + REST + OpenAPI).
// The browser-safe `rpc()` transport lives in `@onedef/orpc/client`.
export { toFetchHandler, toNextHandlers, type FetchHandlerOptions } from './fetch.js'
export { generateOpenApi, type OpenApiOptions } from './openapi.js'
export { toRouter, type AnyProcedure, type OnedefRouter, type RequestContext } from './router.js'
