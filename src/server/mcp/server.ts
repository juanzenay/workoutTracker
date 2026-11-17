import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { getStrings } from "@/strings";
import { renderMessages } from "@/strings/render";
import { CommandError, type Commands } from "../commands";
import { TOOLS, type McpTool } from "./tools";

const text = (value: unknown) => JSON.stringify(value);

/**
 * Runs one tool; CommandErrors become `isError` results Claude can read and act on. Generated text in the result
 * (plan change summaries and reasons, progression reasons) is rendered in the standard words.
 */
async function callTool(tool: McpTool, commands: Commands, input: unknown): Promise<CallToolResult> {
  try {
    const result = renderMessages(getStrings(), await tool.run(commands, input as never)) as Record<string, unknown>;
    return { content: [{ type: "text", text: text(result) }], structuredContent: result };
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    return {
      isError: true,
      content: [{ type: "text", text: text({ error: error.code, message: error.message, details: error.details }) }],
    };
  }
}

/** A fresh MCP server (one per request) whose tools call the command layer as `commands`' actor. */
export function buildMcpServer(commands: Commands, tools: McpTool[] = TOOLS): McpServer {
  const server = new McpServer(
    { name: "workout-tracker", version: "1.0.0" },
    {
      instructions:
        "Workout tracker is the owner's training app: lifting blocks with progression, a run plan anchored to their A race, and " +
        "their logged workouts. Read the calendar, training load, exercise history, block and races before advising. " +
        "Changes are never silent: the write tools (mark_unavailable, add_race, update_race, import_plan, propose_change) " +
        "only propose; show the owner the proposal and call apply_change only once they approve it in chat. Applied " +
        "changes go through the engine and can be undone (undo_change, or in workout tracker). " +
        "Planned runs carry `corosWorkout` sections and whole-second paces so they can be scheduled on a Coros watch with " +
        "the Coros connector; workout tracker has no Coros integration of its own.",
    },
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
      },
      (input: unknown) => callTool(tool, commands, input),
    );
  }
  return server;
}
