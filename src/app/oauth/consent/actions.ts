"use server";

import { redirect } from "next/navigation";
import { requireCommands } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/auth/supabase";

/** Approves or denies a Supabase OAuth authorization request, then sends the browser back to the client (Claude). */
export async function decideAuthorization(formData: FormData) {
  const commands = await requireCommands();
  const { isOwner } = await commands.getAccount({});
  const id = String(formData.get("authorizationId") ?? "");
  if (!isOwner || !id) redirect(`/oauth/consent?authorization_id=${encodeURIComponent(id)}`);

  const supabase = await createSupabaseServerClient();
  const options = { skipBrowserRedirect: true };
  const { data, error } =
    formData.get("decision") === "approve"
      ? await supabase.auth.oauth.approveAuthorization(id, options)
      : await supabase.auth.oauth.denyAuthorization(id, options);
  if (error || !data?.redirect_url) redirect(`/oauth/consent?authorization_id=${encodeURIComponent(id)}`);
  redirect(data.redirect_url);
}
