import type { AnyOp, AnyService } from './contract.js'
import { ApiError } from './errors.js'

type Issue = { message: string; path?: readonly unknown[] }

export const issuesMessage = (issues: readonly Issue[]) =>
  issues
    .map((issue) => {
      const path = (issue.path ?? []).map((segment) =>
        typeof segment === 'object' && segment ? (segment as { key: unknown }).key : segment,
      )
      return path.length ? `${path.join('.')}: ${issue.message}` : issue.message
    })
    .join('; ')

/**
 * Split a call's raw input into the member id and the payload, and validate
 * the payload against the op's input schema. Shared by the backend and the
 * `http()` transport so every surface rejects bad input the same way, with
 * `INVALID_INPUT`, before anything runs or is sent.
 */
export async function parseInput(
  svc: AnyService,
  op: AnyOp,
  raw: Record<string, unknown>,
  where: string,
): Promise<{ id: string | undefined; input: unknown }> {
  const id = op.on === 'member' ? raw[svc.id!] : undefined
  if (op.on === 'member' && (typeof id !== 'string' || id === '')) {
    throw new ApiError('INVALID_INPUT', `${where} needs "${svc.id}"`)
  }
  const { [svc.id ?? '']: _id, ...payload } = raw
  let input: unknown = op.on === 'member' ? payload : raw
  if (op.input) {
    const parsed = await op.input['~standard'].validate(input)
    if (parsed.issues) {
      throw new ApiError('INVALID_INPUT', `${where}: ${issuesMessage(parsed.issues)}`, {
        data: { issues: parsed.issues },
      })
    }
    input = parsed.value
  }
  return { id: id as string | undefined, input }
}

/**
 * Outputs are validated in the backend, not by a transport, so `local()`,
 * REST, RPC and MCP all return the same shape — and a field a handler returns
 * but the contract does not declare is stripped rather than leaked.
 */
export async function validateOutput(op: AnyOp, value: unknown, where: string): Promise<unknown> {
  if (!op.output) return value
  const parsed = await op.output['~standard'].validate(value)
  if (parsed.issues) {
    throw new ApiError(
      'INTERNAL',
      `${where} returned a value that does not match its output schema: ${issuesMessage(parsed.issues)}`,
    )
  }
  return parsed.value
}
