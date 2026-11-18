# @example/recipe

The source of truth, in two entries:

| entry                     | file              | who imports it                                                                 |
| ------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `@example/recipe`         | `src/contract.ts` | everyone: the React app, CLI, MCP, SDK, docs. No server code.                  |
| `@example/recipe/backend` | `src/backend.ts`  | the app's server only: `implement(contract, handlers)` over an in-memory store |

Every op in the contract must have a handler in `backend.ts` (a missing one is
a compile error). Input and output are validated against the contract's
schemas, so handlers only see parsed values and cannot leak fields the
contract does not declare.

This package is `private` and has no build step: apps import its TypeScript
directly. To release an SDK without releasing it, see `../sdk`.
