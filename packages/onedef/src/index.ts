// The contract — shipped everywhere, holds no server code.
export {
  defineConfig,
  defineService,
  defineApi,
  query,
  mutation,
  eachOp,
  opOf,
  type Api,
  type ApiConfig,
  type AnyOp,
  type AnyService,
  type HttpDescriptor,
  type HttpMethod,
  type In,
  type OpDef,
  type OpKind,
  type OpRef,
  type Out,
  type Result,
  type Schema,
  type ScopeDef,
  type ScopeRegistry,
  type ServiceDef,
  type ServiceMap,
  type ResourceInfo,
  type FieldsOf,
  type ModeOf,
  type ScopeOf,
} from './contract.js'

// Objects — collections and singletons, compiled down to ops.
export {
  action,
  arrayOf,
  collection,
  pageOf,
  singleton,
  withPaging,
  type ActionDef,
  type Page,
  type Paging,
} from './resource.js'

// Calling it — the typed client over any transport.
export {
  createClient,
  type ApiClient,
  type Call,
  type CallOptions,
  type ClientOptions,
  type InputOf,
  type OpInput,
  type OpResult,
  type OutputOf,
  type ServiceClient,
  type Transport,
} from './client.js'
export { http, callDescriptor, forwardedHeaders, resolve, type HttpOptions, type Resolvable } from './http.js'

// Answering it — server only.
export {
  implement,
  isBackend,
  local,
  type Backend,
  type ContextArgs,
  type HandlerArgs,
  type Handlers,
  type ImplementOptions,
  type OptionsFor,
  type ServiceHandlers,
} from './implement.js'
export {
  withProcesses,
  type HasProcess,
  type NextInput,
  type NextOp,
  type ProcessRun,
  type ProcessState,
  type ProcessTools,
  type RunStore,
  type StartOp,
  type WithProcesses,
} from './process.js'
export { ApiError, codeOf, fail, isApiError, statusOf } from './errors.js'
export { parseInput } from './validate.js'

// Shared building blocks for the surface packages.
export { forMode, hiddenFields, redact } from './access.js'
export {
  credentialHeaders,
  credentialsFromEnv,
  credentialsFromHeaders,
  type AuthConfig,
  type Credentials,
} from './auth.js'
export { scopeFromHeaders, scopeHeaders, scopesOf, type NamedScope, type ScopeValues } from './scope.js'
export { commandPath, kebab, navEntry, routeOf, snake, toolName, type Route } from './names.js'
export {
  omitFrom,
  registerJsonSchemaConverter,
  stripKeys,
  toJsonSchema,
  withPathKeys,
  type JsonSchema,
} from './jsonschema.js'
