"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { authRedirectOrigin } from "@/lib/auth/redirect-origin";
import { safeReturnPath } from "@/lib/auth/return-path";
import { signupFoundationPath } from "@/lib/auth/foundation-path";
import { createClient } from "@/lib/supabase/server";

async function siteUrl() {
  return authRedirectOrigin(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000", (await headers()).get("origin"), process.env.NUDGE_PUBLIC_LAUNCH !== "true");
}

export type AuthState = { error?: string; message?: string };

function emailSendError(error: { code?: string }, signup: boolean) {
  if (error.code === "email_address_not_authorized") return signup
    ? "Email signup is temporarily limited. Continue with Google instead."
    : "Reset email is temporarily unavailable. Try again later.";
  if (error.code === "over_email_send_rate_limit") return signup
    ? "Email signup is busy right now. Try again later or continue with Google."
    : "Too many email requests. Try again later.";
  return signup
    ? "Could not create the account. Try again or continue with Google."
    : "Could not send the reset email. Try again later.";
}

export async function signInWithEmail(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) return { error: "Email or password is incorrect." };
  revalidatePath("/", "layout");
  redirect(safeReturnPath(formData.get("next")));
}

export async function signUpWithEmail(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  if (process.env.NEXT_PUBLIC_EMAIL_SIGNUP_ENABLED === "false") return { error: "Create your demo account with Google." };
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "");

  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(signupFoundationPath(formData.get("next")))}`,
    },
  });
  if (error) return { error: emailSendError(error, true) };
  return { message: "Check your inbox to confirm your email, then sign in." };
}

export async function signInWithGoogle(formData:FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(formData.get("foundation")==="on" ? signupFoundationPath(formData.get("next")) : safeReturnPath(formData.get("next")))}` },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    String(formData.get("email") ?? ""),
    { redirectTo: `${await siteUrl()}/auth/callback?next=/update-password` }
  );
  if (error) return { error: emailSendError(error, false) };
  return { message: "Reset link sent. Check your inbox." };
}

export async function updatePassword(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const supabase = await createClient();
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Could not update the password. The link may have expired." };
  redirect("/dashboard");
}


/* Guest mode removed: anonymous sessions can't be recovered if the browser is
   cleared and complicate abuse controls. Existing anonymous accounts can still
   upgrade to email via the profile page; no new ones can be created. Also
   disable "Allow anonymous sign-ins" in Supabase → Authentication. */

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
