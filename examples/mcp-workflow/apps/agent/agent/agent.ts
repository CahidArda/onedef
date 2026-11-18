import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
import { scriptedTurn } from "./lib/scripted.js";

// The agent's model is a scripted stand-in (eve's mockModel): it drives the
// workflow exactly as a careful model would, so the evals are deterministic and
// need no API key.
export default defineAgent({
  model: mockModel({ modelId: "scripted-guide-writer", provider: "fixtures", respond: scriptedTurn }),
});
