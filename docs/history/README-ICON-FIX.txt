Nudge Hindsight icon-import fix

Stop npm run dev with Ctrl+C.
Extract Nudge-Icon-Fix.zip into your EXISTING Hindsight project folder (the folder containing package.json). Overwrite the three matching files. The ZIP keeps their correct relative paths.

Changed files:
next.config.ts
src/components/landing/navbar.tsx
src/components/landing/interactions.tsx

Run in that folder:
node -e "require('fs').rmSync('.next',{recursive:true,force:true})"
npm run dev

Open the Local URL printed by the new server. No SQL, environment-file or dependency changes are needed for this patch. Node 24 installations must meet the package minimum of 24.15.0.
