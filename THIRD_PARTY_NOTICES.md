# Third-party notices

The native app's two mechanical interaction samples (`mouseclick1.ogg`, `mouserelease1.ogg`) come from [Kenney UI Audio](https://kenney.nl/assets/ui-audio), CC0. Original license and provenance are in `mobile/assets/sounds/`. Expo Audio and Expo Haptics follow their bundled Expo/MIT package notices.

Nudge uses the packages and pinned versions in `package-lock.json`. Retain their license files when distributing dependencies or a compiled application. The app's own code is not assigned a new open-source license by this update; the project owner decides its distribution terms.

- Inter fonts: SIL Open Font License 1.1. Full notice in `licenses/Inter-OFL.txt`; project https://github.com/rsms/inter.
- Playfair Display fonts: SIL Open Font License 1.1, with the reserved family name Playfair Display. Full notice in `licenses/Playfair-Display-OFL.txt`; project https://github.com/clauseggers/Playfair-Display.
- Next.js / React / Supabase JavaScript libraries / Tailwind CSS / Framer Motion: their upstream package notices govern distribution. See the installed package LICENSE files.
- Lucide icons: https://lucide.dev/license. Preserve the ISC/MIT notices supplied with the icon package.
- Playwright, PGlite, jsdom and the optional bundled Chromium package are development/test dependencies. Chromium is not served to application users; follow its package notices if separately distributing a test runtime.

Only the self-hosted WOFF2 files used by the app are retained. Unused font copies were removed. The existing Nudge application icons remain user-provided project assets; the operator must confirm their rights to these assets and the brand before public launch. Font license inclusion does not establish rights to a brand name or every possible future uploaded asset.

The Hindsight landing page adds self-hosted Bricolage Grotesque (SIL OFL 1.1), Motion, Phosphor icons and customized Radix primitives. The full font license is in `licenses/Bricolage-Grotesque-OFL.txt`. Landing fonts/tokens are scoped to the public page; existing application fonts are retained. Runtime notices are regenerated from installed package licenses. Axe and Lighthouse are development-only audit tools.
