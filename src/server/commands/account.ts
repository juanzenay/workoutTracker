import { z } from "zod";
import { defineCommand } from "./define";

/** Whether the caller is the deployment's owner (the first account). Gates the MCP connector and OAuth consent. */
export const getAccount = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    const [row] = await tx<{ is_owner: boolean }[]>`select public.is_owner() as is_owner`;
    return { isOwner: row!.is_owner };
  },
});

/** Whether an owner has claimed this deployment yet. Anyone may ask: the sign-in page offers the claim only while it is open. */
export const getDeploymentStatus = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    const [row] = await tx<{ claimed: boolean }[]>`select public.deployment_claimed() as claimed`;
    return { claimed: row!.claimed };
  },
});
