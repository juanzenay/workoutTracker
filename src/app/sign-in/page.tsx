import { createCommands } from "@/server/commands";
import { getSql } from "@/server/db/client";
import { getRequestStrings } from "@/server/strings";
import { ClaimForm } from "./claim-form";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next, confirm } = await searchParams;
  const s = await getRequestStrings();
  // Until someone claims the deployment, this page creates the owner account instead of signing in.
  const { claimed } = await createCommands({ sql: getSql(), actor: { kind: "anon" } }).getDeploymentStatus({});
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-3xl font-semibold">{claimed ? s.app.name : s.claim.title}</h1>
        <p className="mt-1 text-muted">{claimed ? s.signIn.subtitle : s.claim.subtitle}</p>
      </div>
      {confirm === "failed" && (
        <p role="alert" className="text-sm text-danger">
          {s.signIn.confirmFailed}
        </p>
      )}
      {claimed ? <SignInForm next={typeof next === "string" ? next : undefined} /> : <ClaimForm />}
    </main>
  );
}
