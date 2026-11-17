import type { TransactionSql } from "postgres";
import type { z } from "zod";
import type { EngineInput, EngineOutput } from "@/engine/plan";
import type { BackupTargets } from "../backup/targets";
import type { Actor } from "../db/actor";
import type { HevyClient } from "../hevy/client";
import type { StravaClient } from "../strava/client";
import type { PushMessage } from "../push/sender";
import type { WgerClient } from "../wger/client";

export interface CommandContext {
  /** A transaction already running as `actor` (RLS applies). */
  tx: TransactionSql;
  actor: Actor;
  /** wger API (fallback exercise search). Called outside the database; tests inject recorded responses. */
  wger: WgerClient;
  /** Hevy API (history import). Called outside the database; tests inject recorded responses. */
  hevy: HevyClient;
  /** Strava API (OAuth, activities, webhook subscription). Tests inject recorded responses. */
  strava: StravaClient;
  /** The planning engine (src/engine/plan.ts). Tests wrap it to pin `today` or flag fixture changes. */
  engine: Engine;
  /** The current time (when a day is over, token expiry). Tests pin it. */
  now: () => Date;
  /**
   * Queues a Web Push to every subscribed device. Sent only after this command's transaction
   * commits (never on rollback). Prefer `raiseInboxItem()` (./inbox.ts), which pushes important items.
   */
  push: Push;
  /** Nightly backup targets (GitHub, Supabase Storage fallback); `null` entries are not configured. Tests inject fakes. */
  backup: BackupTargets;
  /**
   * Set while a coach change is being applied (or tried out for a proposal, or
   * undone): re-plans fold the engine changes they cause into that coach
   * revision instead of recording them on their own (./coach.ts).
   */
  coachChangeId?: string;
}

export type Push = (message: PushMessage) => void;

export type Engine = (input: EngineInput) => EngineOutput;

export interface CommandDefinition<Input extends z.ZodType, Output> {
  /** Validates and normalises input before `run`; its JSON shape doubles as the MCP tool schema later. */
  input: Input;
  run(ctx: CommandContext, input: z.output<Input>): Promise<Output>;
}

/** Declares one command-layer operation. Register it in ./index.ts. */
export function defineCommand<Input extends z.ZodType, Output>(
  definition: CommandDefinition<Input, Output>,
): CommandDefinition<Input, Output> {
  return definition;
}

/**
 * What a multi-step command gets instead of one transaction: each `transaction` runs as the actor and commits
 * when it returns, so the command can call an outside service between database steps without holding a
 * transaction open across the call (and without losing what it did there if the process dies mid-call).
 */
export interface StepsContext extends Omit<CommandContext, "tx"> {
  transaction<T>(work: (tx: TransactionSql) => Promise<T>): Promise<T>;
}

export interface StepsDefinition<Input extends z.ZodType, Output> {
  input: Input;
  steps: true;
  run(ctx: StepsContext, input: z.output<Input>): Promise<Output>;
}

/** Declares a multi-step operation (see `StepsContext`). Prefer `defineCommand`; use this only around outside calls. */
export function defineSteps<Input extends z.ZodType, Output>(
  definition: Omit<StepsDefinition<Input, Output>, "steps">,
): StepsDefinition<Input, Output> {
  return { ...definition, steps: true };
}

export type CommandErrorCode =
  | "invalid_input"
  | "unauthorized"
  | "not_found"
  | "conflict"
  /** An external service (e.g. wger) is unreachable or answered something unusable; retrying later may work. */
  | "unavailable";

/** The only error type commands throw on purpose; callers (UI, MCP, webhooks) map `code` to their own responses. */
export class CommandError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CommandError";
  }
}
