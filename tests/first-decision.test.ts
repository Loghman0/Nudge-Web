import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { safeReturnPath } from "../src/lib/auth/return-path";
import { signupFoundationPath } from "../src/lib/auth/foundation-path";
import { authRedirectOrigin } from "../src/lib/auth/redirect-origin";

const nativeRequire = createRequire(import.meta.url);
function load(path: string, modules: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled, {
    exports, require: (name: string) => modules[name] ?? nativeRequire(name),
    URL, Date, console, process: { env: { NEXT_PUBLIC_SITE_URL: "https://nudge.test" } },
  });
  return exports;
}

describe("foundation setup and first decisions", () => {
  it("keeps the preview review destination through email confirmation without repeating foundation setup", () => {
    assert.equal(signupFoundationPath('/discovery-save'), '/discovery-save');
    assert.equal(signupFoundationPath('https://outside.invalid/discovery-save'), '/onboarding');
  });  it("sends signup confirmations to foundation setup and defers deliberate return paths", async () => {
    const destinations: string[] = [];
    const actions = load("../src/app/auth/actions.ts", {
      "next/cache": { revalidatePath: () => {} },
      "next/navigation": { redirect: () => {} },
      "next/headers": { headers: async () => new Headers() },
      "@/lib/auth/redirect-origin": { authRedirectOrigin },
      "@/lib/auth/return-path": { safeReturnPath },
      "@/lib/auth/foundation-path": { signupFoundationPath },
      "@/lib/supabase/server": { createClient: async () => ({ auth: { signUp: async (input: any) => { destinations.push(input.options.emailRedirectTo); return { error: null }; } } }) },
    });
    for (const next of [null, "/groups?invite=abc", "https://other.test"]) {
      const form = new FormData();
      form.set("email", "test@example.invalid"); form.set("password", "fixture-password");
      if (next) form.set("next", next);
      assert.ok((await actions.signUpWithEmail({}, form)).message);
    }
    assert.deepEqual(destinations.map(value => new URL(value).searchParams.get("next")), ["/onboarding", "/onboarding?next=%2Fgroups%3Finvite%3Dabc", "/onboarding"]);
    assert.match((await actions.signUpWithEmail({}, new FormData())).error, /at least 8 characters/);
    assert.equal(destinations.length, 3, "invalid credentials must not create an account");
  });
});

