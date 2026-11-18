import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

const done = (output: unknown) => JSON.stringify(output).includes('"status":"done"');

// Gates the protocol: the agent starts one run, answers every step through
// write_guide_next, finishes it, and reports the guide it produced.
export default defineEval({
  description: "The agent drives the write-guide workflow over MCP from start to done.",
  async test(t) {
    const turn = await t.send("Write a short guide about brewing tea.");
    t.succeeded();
    t.calledTool("guides__write_guide", { count: 1 });
    // plan + one call per section (2–4) + review, at least
    t.calledTool("guides__write_guide_next", { count: (count) => count >= 4 });
    t.calledTool("guides__write_guide_next", { output: done });
    t.check(turn.reply, includes("tea"));
  },
});
