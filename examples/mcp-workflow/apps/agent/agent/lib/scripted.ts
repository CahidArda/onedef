/**
 * A scripted stand-in for the model: it drives the guide workflow through
 * eve's catalog tool exactly as a careful model would, with no API key. It
 * makes the eve evals deterministic, so CI runs them on every push.
 */
import type { MockModelRequest, MockModelResponse } from "eve/evals";

type State = {
  runId: string;
  status: "waiting" | "done" | "failed";
  waitingFor?: { name: string; data?: { title?: string } };
  output?: { summary: string; sections: { title: string; body: string }[] };
};

/** The workflow's state in a tool result, whatever shape eve normalized it to. */
function stateIn(output: unknown): State | undefined {
  if (typeof output === "string") {
    try {
      return stateIn(JSON.parse(output));
    } catch {
      return undefined;
    }
  }
  if (!output || typeof output !== "object") return undefined;
  if ("runId" in output && "status" in output) return output as State;
  for (const value of Object.values(output)) {
    const found = Array.isArray(value) ? value.map(stateIn).find(Boolean) : stateIn(value);
    if (found) return found;
  }
  return undefined;
}

function answer(waitingFor: NonNullable<State["waitingFor"]>) {
  if (waitingFor.name === "plan") return { sections: ["Choosing leaves", "Brewing", "Serving"] };
  if (waitingFor.name.startsWith("section-")) {
    return { body: `${waitingFor.data?.title}: the essentials, explained in a few clear sentences for a beginner.` };
  }
  return { summary: "A three-part guide to making a good cup of tea.", approved: true };
}

const call = (name: string, input: unknown): MockModelResponse => ({
  toolCalls: [{ name: "eve__tool", input: { name, input } }],
});

export function scriptedTurn({ toolResults, lastUserMessage }: MockModelRequest): MockModelResponse | string {
  const last = toolResults.at(-1);
  if (!last) {
    const topic = /about (.+?)[.?!]*$/i.exec(lastUserMessage ?? "")?.[1] ?? "tea";
    return call("guides__write_guide", { topic });
  }
  const state = stateIn(last.output);
  if (!state) return `The workflow returned something unexpected: ${JSON.stringify(last.output)}`;
  if (state.status === "waiting" && state.waitingFor) {
    return call("guides__write_guide_next", { runId: state.runId, payload: answer(state.waitingFor) });
  }
  if (state.status === "done" && state.output) {
    const sections = state.output.sections.map((s) => `## ${s.title}\n${s.body}`).join("\n\n");
    return `${state.output.summary}\n\n${sections}`;
  }
  return `The run failed: ${JSON.stringify(state)}`;
}
