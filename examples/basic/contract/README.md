# @example/basic-contract

The source of truth, in two entries:

| import | file | who imports it |
| --- | --- | --- |
| `@example/basic-contract` | `src/contract.ts` | everyone: the app's frontend, CLI, MCP, SDK, docs. No server code. |
| `@example/basic-contract/backend` | `src/backend.ts` | the app's server only: `implement(contract, handlers)` over an in-memory store |

Every op in the contract needs a handler in `backend.ts`: a missing one is a compile error.
Inputs and outputs are validated against the contract's schemas, so handlers only see
parsed values and can't leak fields the contract doesn't declare.

The package is `private` and has no build step: the other packages import its TypeScript
directly. To release an SDK without releasing it, see [`../sdk`](../sdk).

Docs: [Contract](https://onedef.cahidarda.com/docs/define/contract) ·
[Backend](https://onedef.cahidarda.com/docs/define/backend)
