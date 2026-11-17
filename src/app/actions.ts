"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { saveSkin, saveTheme, THEMES } from "@/server/preferences";
import { SKINS } from "@/strings";

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}

export async function setTheme(formData: FormData) {
  const theme = THEMES.find((t) => t === formData.get("theme"));
  if (theme) await saveTheme(theme);
}

/** Dumb Mode on ("dumb") or off ("standard"), for this device only (#28). */
export async function setSkin(formData: FormData) {
  const skin = SKINS.find((s) => s === formData.get("skin"));
  if (skin) await saveSkin(skin);
}
