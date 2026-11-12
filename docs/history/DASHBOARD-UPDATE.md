# Hindsight dashboard update, 2026-10-14

The dashboard and shared authenticated navigation now use the Hindsight blue-gray/cobalt palette and self-hosted Bricolage typography. The landing remains as delivered. This extends the previous landing-only scope at the owner's request. Other authenticated pages inherit the updated shell/palette; their page-specific layouts and functions have not been redesigned in this update.

## Dashboard behavior

- One clear comparison action, actual preference-based Today's Nudge, and a due-reflection prompt when the existing query returns a due decision.
- Real decision, streak/freeze and preference totals; the streak remains the canonical database value.
- Actual memory-strength score, strongest recorded topics and a plain explanation that this score is not a probability that a recommendation is right.
- Recent choices now open their matching history anchor. New accounts get usable empty states instead of fabricated activity.
- Existing Discover, History, Patterns, Circles and About you destinations are preserved. Sign out, theme toggle, mobile navigation and legal links retain their functions.
- Removed dashboard glow orbs, decorative looping motion and repetitive card rows. Spatial controls have simple press feedback and reduced motion support.

Shared shell changes are visual: scoped tokens, wordmark, sidebar active marker, 44px+ header controls and a safe-area-aware mobile bar. A desktop regression showing the mobile wordmark twice was found and fixed. Legacy accent buttons/badges retain contrast in dark mode through scoped foreground tokens. Auth/session/terms logic is unchanged.

The dashboard's Supabase queries and existing services are retained. Activity copy now says the last seven days rather than implying a calendar week, and future decision timestamps are excluded from that rolling count. Today's preference copy no longer claims outcomes that the stored preference alone cannot establish.

## Validation

- `npm run verify`: passed typecheck, 113 unit/SQL/component tests, production build.
- Browser regression: four scenarios passed, including a real disposable-account dashboard, public pages and landing interactions/accessibility.
- Focused dashboard rerun: passed after adding explicit HTML theme and computed background assertions; Playwright's persisted run status is passed with no failed tests. This prevents an asynchronous system-theme switch from mislabeling a screenshot.
- Real flow: sign in, empty dashboard, prefilled comparison, save Soup/Pizza comparison, choose an option, schedule a check-in, confirm dashboard count/history update, open the matching record and refresh while signed in.
- Light/dark Axe checks for WCAG 2/2.1/2.2 A/AA tags: zero violations in the tested empty dashboard at 320/375/768/1440px and the populated dashboard at 1440px. No horizontal overflow at those widths. Reduced-motion mode was exercised.
- Dedicated test accounts were deleted; the final fixture's absence was verified. No other accounts were targeted.
- Forty-five protected API, auth, service and SQL files compared byte-for-byte with the preceding ZIP: identical. No SQL migration is required.

`evidence/dashboard/` contains command logs, focused theme-run status, cleanup confirmation and ten screenshots. The screenshots contain only the disposable fictional test account and test choices. Production/field performance has not been measured for the authenticated dashboard. The earlier landing Lighthouse results describe the earlier landing build, not this dashboard.

Public-launch operator/contact/hosting/retention configuration remains required as documented in LAUNCH.md; no legal or publication certification is claimed by this UI update.

## Files and installation

Changed: `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/layout.tsx`.
Added: `src/components/app/dashboard-view.tsx`, `src/components/app/workspace.css`, `tests/dashboard-view.test.ts`, `e2e/dashboard.spec.ts`.
No new dependencies or database changes.

For the small patch, stop the server, extract Nudge-Dashboard-Update.zip into the working Hindsight project folder containing package.json, overwrite matching files, then run:

```sh
node -e "require('fs').rmSync('.next',{recursive:true,force:true})"
npm run dev
```

Keep .env.local. Use the localhost address printed by the new server. The full app ZIP also includes this update and the prior Phosphor icon fix.
