import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requireCommands } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { getRequestStrings } from "@/server/strings";
import { decideAuthorization } from "./actions";

/**
 * Supabase Auth's OAuth server sends the owner here (Authorization Path
 * `/oauth/consent`) when Claude asks to connect. Signed-out visitors go
 * through /sign-in first (src/proxy.ts keeps this URL as `next`).
 */
export default async function ConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  const s = await getRequestStrings();
  const { authorization_id } = await searchParams;
  const commands = await requireCommands();
  const { isOwner } = await commands.getAccount({});

  const supabase = await createSupabaseServerClient();
  const id = typeof authorization_id === "string" ? authorization_id : "";
  const { data, error } = isOwner && id ? await supabase.auth.oauth.getAuthorizationDetails(id) : { data: null, error: null };
  // Already approved for this client: straight back to it.
  if (data && "redirect_url" in data) redirect(data.redirect_url);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-semibold">{s.connect.title}</h1>
      {!isOwner ? (
        <p role="alert">{s.connect.notOwner}</p>
      ) : !data || error ? (
        <p role="alert">{s.connect.failed}</p>
      ) : (
        <>
          <p>{s.connect.asks(data.client.name || s.connect.unknownClient)}</p>
          <p>{s.connect.reads}</p>
          <p className="text-sm text-muted">{s.connect.redirect(data.redirect_uri)}</p>
          <form action={decideAuthorization} className="flex gap-3">
            <input type="hidden" name="authorizationId" value={data.authorization_id} />
            <Button type="submit" name="decision" value="approve" className="flex-1">
              {s.connect.approve}
            </Button>
            <Button type="submit" name="decision" value="deny" variant="secondary" className="flex-1">
              {s.connect.deny}
            </Button>
          </form>
        </>
      )}
    </main>
  );
}
