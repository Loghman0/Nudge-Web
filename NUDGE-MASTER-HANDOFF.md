# Nudge — davam üçün master plan

Yenilənib: 10 noyabr 2026. İş qovluğu: `C:\Users\User\Desktop\Projects\Nudgenew`.

Bu sənəd layihəni başqa AI-yə kiçik tapşırıqlarla təhvil vermək üçündür. Tətbiqi sıfırdan yazmaq lazım deyil. Mövcud kodu saxla və üzərində işlə. Qeyri-müəyyən məhsul, dizayn, xidmət və məlumat qərarlarında istifadəçidən soruş; operator məlumatı, qiymət, sübut və nəticə uydurma.

## Son checkpoint — Android push

0.9.1 mobil önizləməsi Nudge giriş animasiyasını, 15 dəqiqəlik fasilədən sonra Today-ə qayıdışı və daha yığcam Account və Tools ekranlarını əlavə edir. Yaddaşda uyğun müqayisə tapılmadıqda **Compare with one priority** variantları saxlayıb prioritet formasını açır. Gündəlik sual üçün `00021_native_daily_questions.sql` canlı bazada tətbiq edilib. Scheduler və cihaz qeydiyyatı yoxlanıb. Real telefonun gündəlik sualı alması ayrıca yoxlanmalıdır. Davam addımları `mobile/docs/NEXT-TASK.md` və `mobile/docs/OPENING-MOTION.md` fayllarındadır.

0.8.1: native bildirişlər, FCM xidməti, migration00020 və private5-dəqiqəlik scheduler hazırdır. 823 geniş backend testi +1 scheduler testi,91 native testi keçir. APK və test-imzalı AAB VERIFICATION.md-də hash ilə göstərilib. Real Redmi15C/Android15-də Google qayıdışı, hesabın yeniləmədən sonra qalması, sual/cavab axını və bildiriş gəlib tətbiqi açması yoxlanıb. Wi-Fi-də SSL xətası var; mobil internetdə sayt/tətbiq işləyir, DNS/router/ISP səbəbi hələ müəyyənləşməyib. APK/Play fərqini saxla; hazırda store upload identity və tam qəbul yoxlamaları tamamlanmayıb. İstifadəçi18 yaşındadır.

## 1. İndiki vəziyyət

- Nudge özünü tanımağa kömək edən, sonradan həmin bilikdən seçimlərdə istifadə edən tətbiqdir.
- Web: Next.js 16.4.3 + Supabase, `https://projectnudge.vercel.app`.
- Mobile: React Native 0.88.1 / React 19.3 / Expo 58.0.23. **Müstəqil native APK-dir; WebView deyil.** Android birincidir; iOS hazır sayılmır.
- Paket: `com.projectnudge.app`. Mobil mənbə versiyası 0.9.1 / versionCode 11. Cihaz sübutları versiya üzrə ayrıca saxlanılır.
- Mənbə yoxlamaları: **823 web/backend testi + 1 scheduler SQL testi, 91 native testi**, native TypeScript, doqquz ortaq mənbə hash-i. Bunlar fiziki cihaz yoxlaması deyil.
- Push backend production deploy: `dpl_HeDwdM6m1oqLNWnZWjMdDGhpbMSi`.
- Ən son APK, hash, device yoxlaması və məhdudiyyətlər üçün **`mobile/docs/VERIFICATION.md` əsas mənbədir**. Köhnə və unversioned APK-ni avtomatik ən yenisi sayma.
- Təxmini tam mobile v1 hazırlığı **75%, qalan iş 25%**. Bu ölçülmüş faiz və vaxt zəmanəti deyil. Əsas funksiyaların kodu təxminən 95%-dir; cihaz/auth/accessibility/store yoxlamaları ayrıca böyük işdir. Hesab: `mobile/docs/COMPLETION-2026-11-10.md`.
- Git tarixçəsi hazırda yoxdur. Fayl xəritəsi commit diff-i deyil; mənbə vəziyyətinin inventarıdır.

## 2. İstifadəçinin dəyişməz qərarları

1. Brend Nudge, vahid mövcud mavi logo. Adı, palitranı və arxitekturanı səbəbsiz dəyişmə.
2. Light-only. Dark mode əlavə etmə.
3. Hesabsız ilk altı qısa, asan sual. Altı cavabdan əvvəl sign-in/sign-up düyməsi göstərmə; Skip cavab sayılır.
4. Variantı seçmək saxlayır və növbəti suala keçir. Back əvvəlki cavabı dəyişməyə imkan verir. Mətn/ranking bir neçə əməliyyat tələb etdiyi üçün açıq Save saxlanır.
5. Əsas ekranlar normal kiçik telefonda bir viewport-a sığmağa çalışmalıdır. Böyük şrift/landscape üçün scroll saxla; mətnləri kəsmə və şrifti məcburən kiçiltmə.
6. Auth-dan sonra Today, You, Decide, Tools, Account. İkinci dərəcəli funksiyalar menyularda; adi mavi mətn linkləri əvəzinə düzgün action düymələri.
7. “A moment for yourself”, “One question is enough. Stay curious for as long as you like”, artıq preview/privacy sloganlarını yenidən əlavə etmə.
8. Google-first demo seçilib. SMTP və email signup bilərəkdən sonraya saxlanıb; işləyirmiş kimi göstərmə.
9. Mood: Happy, Excited, Calm, Sad, Angry, Anxious, Tired, Mixed + No preference. Mood və pace ayrı anlayışlardır.
10. İstifadəçi **gündə bir dəfə, optional mood popup + Skip** seçib. Hazır native mexanizm hesab üzrə cihazın lokal gününü izləyir; yalnız gün markerini encrypted storage-də saxlayır, emosiyanı profilə yazmır. Preview claim-dən əvvəl popup yoxdur; yarımçıq cavabı və save əməliyyatını kəsmir.
11. Mood seçimə avtomatik qalib təyin etmir. İstifadəçi təsdiqləmək üçün prioritetlər görür, özü əlavə edir və variantları qiymətləndirir. “Əsəbisən, ona görə B” kimi əsassız nəticə yoxdur.
12. Emosiyadan diaqnoz/daimi şəxsiyyət xüsusiyyəti çıxarma. Sualların rahatlığı üçün uyğunlaşdırma psixometrik təsdiq deyil.

## 3. Hazır olan əsas hissələr və fayllar

| Sahə | Əsas fayllar |
|---|---|
| Native giriş və encrypted auth | `mobile/App.tsx`, `mobile/src/use-native-auth.ts`, `mobile/src/auth-*`, `mobile/src/secure-storage.ts` |
| Altı sual, Back, lokal preview | `mobile/src/preview.ts`, `mobile/src/components/QuestionInput.tsx`, `mobile/src/core/questions.json` |
| Google logo/düymə | `mobile/src/components/GoogleButton.tsx`, `mobile/assets/google-g.png`, `mobile/docs/GOOGLE-SIGN-IN-ASSET.md` |
| Native Today / profil / claim / retry | `mobile/src/AccountScreen.tsx`, `mobile/src/discovery-api.ts`, `mobile/src/components/ProfilePanel.tsx` |
| Mood və gündəlik popup | `src/lib/discovery/mood.ts`, `selection.ts`, `types.ts`; `mobile/src/mood-check-in.ts`, `components/MoodCheckIn.tsx`, `MoodChoices.tsx`, `TopicSheet.tsx` |
| Web mood | `src/components/discovery/daily-client.tsx`, `src/lib/api/v1/discovery-route.ts` |
| Native seçim formu / criteria / draft | `mobile/src/DecisionScreen.tsx`, `components/DecisionForm.tsx`, `decision-draft.ts`, `decision-api.ts` |
| Web seçim | `src/app/(app)/ask/decide-client.tsx`, `criteria-editor.tsx`, `src/lib/services/comparison-*` |
| Journal filter / Let it go | `mobile/src/components/JournalFilters.tsx`, `src/lib/services/decision-abandon.ts`, `src/lib/api/v1/abandon-route.ts` |
| Custom check-in | `mobile/src/components/ReminderSheet.tsx`, `mobile/src/reminder-time.ts`, `src/lib/services/reminder-local-time.ts` |
| Timeline / tools / circles | `mobile/src/MoreTools.tsx`, `more-api.ts`, `src/lib/services/native-timelines.ts`, `src/lib/api/v1/tools-route.ts` |
| Account / export / delete / settings | `mobile/src/AccountTools.tsx`, `account-api.ts`, `SettingsTools.tsx`, `settings-api.ts`, `FoundationTools.tsx` |
| Design sistemi | `mobile/src/theme.ts`, `components/native-ui.tsx`, `NativeTabs.tsx` |
| Backend adapterlər | `src/lib/api/v1/`, `src/app/api/v1/` |
| Native test və build | `mobile/tests/`, `mobile/scripts/build-apk.ps1`, `verify-apk.ps1`, `sync-core.mjs`, `mobile/plugins/` |
| Mövcud web/backend regression | `tests/` |

`mobile/src/core/` generated nüsxədir. Əllə dəyişmə. Ortaq web faylını dəyiş, sonra `npm run sync:core` işlə və hash-ləri yoxla.

## 4. Qalan mərhələlər — bu ardıcıllıqla

### P0 — hazır checkpoint-i qorumaq

- `mobile/docs/VERIFICATION.md`, `PARITY.md`, `MOOD-2026-11-10.md` oxu.
- Versioned APK-ni ayrıca saxla. `mobile/android` generated-dir; plugin/mənbələr qorunmalıdır.
- Disposable test hesabı açıq qalıbsa `.local/native-device-fixture.json` və cleanup helper ilə **yalnız metadata ilə təsdiqlənən test hesabını** sil, yoxluğunu təsdiqlə. Gizli tokenləri chat-a çıxarma.
- Əvvəlki APK-dən yeni APK-yə sübutu səssiz köçürmə. Test qeydi build hash-i ilə uyğun olmalıdır.

**Bitmə şərti:** təhvil APK-si, hash-i, test nəticələri, açıq məhdudiyyətlər və test hesablarının cleanup-u yazılıb.

### P1 — real telefonda Google auth və əsas yol

Fayllar: auth protocol/hook, `AccountScreen`, `AccountTools`, auth testləri. Əvvəl mövcud PKCE mexanizmini oxu.

- APK-ni ən az bir real Android telefonda quraşdır.
- Altı sual → Google → tətbiqə callback → cavabların ayrıca review/save → Today.
- Cancel, app background/process death, expired/revoked session, logout, başqa hesab, privacy generation dəyişməsi.
- Callback artıq owner icazəsi ilə `com.projectnudge.app://auth/callback` kimi allowlist-dədir. Səbəbsiz dəyişmə; credential/OTP-ni istifadəçi daxil edir.

**Bitmə şərti:** hər ssenari üçün cihaz/OS/build hash/result qeyd olunub; başqa hesaba draft/cavab sızmır. Debug fixture login real Google sübutu deyil.

### P2 — kiçik UX/accessibility düzəlişləri

Fayllar: yalnız problemli ekran + `theme.ts`/ortaq component zəruri olduqda.

- TalkBack label/focus, selected/disabled/busy state, Back/Close/Skip.
- 200% text/display scale, klaviatura, landscape, uzun cavablar, RTL, scroll-lu siyahılar.
- Mood popup gündə bir dəfə; Skip; eyni gün cold restart-da təkrar çıxmaması; yeni gündə köhnə mood-un silinməsi; yarımçıq mətnin saxlanması.
- Mood seçmək criteria/weights/ratings-i dəyişmir; yalnız Use priority təsdiqi manual criterion əlavə edir. Bütün ratings boşdursa winner olmamalıdır.
- Sadə dil, sayların tək/cəm forması, boş/error/loading halları; yeni dizayn sistemi yaratma.

**Bitmə şərti:** bug siyahısındakı konkret addımlar real cihazda təkrar edilir və düzəlişdən sonra keçir. Screenshot usability tədqiqatı sayılmır.

### P3 — qalan AI alətlərinin native parity-si

Mənbələr: web `profile/privacy-controls.tsx`, reviewed-memory/AI service-lər, durable usage/attempt accounting, native `MoreTools` və bearer adapterlər.

İşi böl: (a) kontrakt/test, (b) auth/consent/limits adapter, (c) native input, (d) review/edit/confirm, (e) timeout/conflict/cleanup, (f) monthly recap.

- Reviewed note intake 0.6.0 mənbəsində və deployed bearer adapterlərdə hazırdır: `mobile/docs/NOTES-2026-11-10.md`. Tools → Add a note; ayrıca review/edit/select/confirm və exact retry var. AI hazırda unavailable olduğundan real model keyfiyyəti açıqdır. Monthly recap native portu 0.7-də hazırdır; real provider keyfiyyəti hələ açıqdır.
- Private AI key yalnız serverdə. Actual provider/key/region/model/rate/budget qeyri-müəyyəndirsə istifadəçidən soruş.
- Mövcud AI ledger/attempt metering/fail-closed fallback-u keçmə. Unknown qiymət “pulsuz” və ya 0 deyil.
- Modelin dediyi memory-ni avtomatik saxlama: istifadəçi mətnə baxır, düzəldir, təsdiqləyir. Silinmiş/forgotten məlumatı geri gətirmə.
- Sərbəst terminin mənasını aydınlaşdır; private oyun/proyekt haqqında fakt uydurma. Etibarlı məlumat yoxdursa abstain/clarify.

**Bitmə şərti:** disposable hesab, real configured provider, consent/privacy/accounting və review/save/conflict testləri keçib. Model adı/key konfiqi runtime keyfiyyət sübutu deyil.

### P4 — native notifications

- Browser VAPID subscription Android native token deyil. FCM/Expo transport-u seçməzdən əvvəl owner-in Firebase/Expo hesabı və pulsuz plan şərtlərini dəqiqləşdir.
- Token registration/unregister, RLS/owner binding, dispatch dedup, quiet hours/timezone, foreground/background/killed-app delivery.
- Permission yalnız istifadəçi reminder istəyəndə; deny etsə in-app check-ins işləməlidir.
- Logout/account deletion tokeni digər hesaba saxlamamalıdır. Köhnə tokenləri təmizlə.

**Bitmə şərti:** real telefonda scheduled delivery, retry/dedup, denial, timezone və logout ssenariləri keçib. DB-də reminder saxlanması push delivery deyil.

### P5 — beta qəbul və stabilizasiya

- Google, Today, You/correction/exclude/delete, criteria comparison, journal, reflection, settings, circles/vote, export, reset/delete end-to-end matrix.
- Şəbəkə kəsilməsi, duplicate taps, lost-success, web/mobile eyni anda dəyişiklik, cached/expired session.
- Real orta səviyyəli cihazda cold start, scrolling, uzun session memory və crash/ANR ölçümü. Emulyatorun System UI cold-boot ANR-i Nudge crash-i kimi təqdim edilməməlidir.
- Kiçik pilotda istifadəçi reflection-un hansı cavaba əsaslandığını izah edə bilir? Səhv reflection-u düzəldə bilir? Topic/mood və delete-i tapır? Nəticəni uydurma.

**Bitmə şərti:** kritik bloklayan bug yoxdur; qalan məhdudiyyətlər açıqdır; konkret regression testləri keçir.

### P6 — Play release, owner hazır olanda

`mobile/docs/PLAY-STORE-READINESS.md` üzrə: protected upload signing + AAB, final application links, manifest/SDK/ELF/16KB runtime/dependency audit, real phone screenshot/listing, deletion URL, həqiqi operator/support/privacy/retention/vendor/Data safety məlumatı, developer account/closed-test tələbləri.

- Test APK Android Debug signer-dır; Play upload key deyil.
- ZIP 16KB padding ELF və real 16KB cihaz uyğunluğunu təsdiqləmir.
- Yaş/şəxsiyyət/maliyyə məlumatı uydurma. Son nəşr istifadəçinin konkret listing/release təsdiqindən sonra.

## 5. Zəif modelə veriləcək hər tapşırıq üçün prompt

```text
Repo: C:\Users\User\Desktop\Projects\Nudgenew
Əvvəl NUDGE-MASTER-HANDOFF.md və mobile/docs/VERIFICATION.md oxu.
Yalnız aşağıdakı tapşırığı et: [bir konkret problem].
Oxuyacağın fayllar: [2–5 dəqiq path].
Dəyişə biləcəyin fayllar: [1–3 dəqiq path].
Mövcud arxitektura və public API-ni saxla. Dependency/SDK upgrade etmə.
Next kodu dəyişirsənsə AGENTS.md və node_modules/next/dist/docs/ uyğun bələdçisini oxu.
Qeyri-müəyyən məhsul/dizayn/məlumat qərarında istifadəçidən soruş; fərziyyə ilə dəyişmə.
Private .env/.local/key/token fayllarını oxuma/çıxarma/göndərmə; .env.example field adları kifayətdir.
Qəbul şərtləri: [2–4 yoxlanılan davranış].
Yoxlamalar: [konkret targeted test/typecheck].
Sonda dəyişən faylları, keçən yoxlamaları, yoxlanmayan runtime hissəni və qalan işi yaz.
Bir tapşırığı bitir; bütün tətbiqi yenidən dizayn etmə.
```

Kiçik modelə P2 copy/layout və targeted test tapşırıqları ver. Auth/SQL/RLS/AI accounting/deletion və signing işini daha güclü model + insan review-u ilə et. Bir neçə AI eyni faylı paralel dəyişməsin. Bütün repo/context-i hər dəfə göndərmək token israfıdır; fayl xəritəsindən lazımi hissəni seç.

## 6. Yoxlama və build qaydaları

- Node 24 və mövcud pinned package-lock istifadə et. Bundled Node: `.playwright-runtime/node-v24.19.0-win-x64/node.exe`.
- Web: targeted `node --import ./tests/register.mjs --test ...`; broad suite üçün `--test-concurrency=2`. Keçmiş yüksək paralellikdə native allocator crash olub; səbəb təsdiqlənməyib.
- Web types/build: `npm run typecheck`, `npm run build`. Breaking Next konvensiyalarını köhnə model yaddaşından tətbiq etmə.
- Native (`mobile` qovluğunda): `npm run sync:core`, `npm run check:core`, `npm run typecheck`, `npm test`.
- APK: `powershell -File mobile/scripts/build-apk.ps1 -Architecture universal`; sonra `mobile/scripts/verify-apk.ps1`-a konkret Artifact/Report path ver.
- **Native CMake build task-larını `-x` ilə keçmə.** Əvvəl belə shortcut iki kitabxanasız, build olunan amma açılmayan APK yaratmışdı. Prebuild generated native output-u silə bilər. Gradle özü up-to-date qərarı verməlidir. Əsas təkrar-yığma əmri public build-apk.ps1-dir; hər artifact üçün native kitabxana/ELF/private-key yoxlamalarını işlət.
- Debug APK Metro istəyə bilər. Paylaşılan test APK release-mode, embedded Hermes, non-debuggable və Metro olmadan açılan olmalıdır.
- İnteqrasiya üçün `.local` test helpers var, lakin private sayılır. Test account metadata-sı yoxlanmadan heç bir hesabı silmə.
- Vercel staging üçün `scripts/stage-vercel.mjs` reviewed `.local/nudge-vercel-project.json` linkini əvvəl yazır. Link yoxdursa dayan; `vercel --yes` ilə təsadüfən yeni project yaratma.

## 7. Pulsuz alətlər

10 noyabr 2026-da rəsmi səhifələrə əsasən:

- [GitHub Copilot Free / Student](https://docs.github.com/en/copilot/get-started/plans): məhdud pulsuz kod köməyi; təsdiqlənmiş tələbə planı ayrıca uyğundur. Limitsiz agent deyil.
- [Ollama](https://ollama.com/pricing): öz kompüterində local inference üçün subscription tələb olunmur; cloud modellər ayrıca ödənişli/token əsaslı ola bilər. Lokal hesablama sürəti/RAM limitlidir.
- [Continue + local model](https://docs.continue.dev/guides/running-continue-without-internet): VS Code daxilində lokal model, offline iş və telemetry söndürmə konfiqi. Extension-in olması pulsuz cloud inference vermir.
- [Aider + Ollama](https://aider.chat/docs/llms/ollama.html): kiçik, konkret kod dəyişiklikləri üçün local model workflow-u. Model/provider ayrıca seçilir; zəif modelə böyük çoxfayllı auth işi vermə.

Ən qənaətli yol: mövcud güclü model limitini auth/AI/push auditinə saxla, kiçik UI/test tapşırıqlarını Copilot Free və ya Continue + lokal model ilə et. RAM-ı az olan kompüterdə local model, Android emulator və build-i eyni anda işlətmə. SDK 58 / RN 0.88 kimi yeni API-lər üçün modelə həmin lokal docs-u ver.

Köhnə “Gemini CLI/Qwen OAuth limitsiz və ya gündə 1000 pulsuzdur” məsləhətini yoxlamadan qəbul etmə; xidmət şərtləri dəyişib. İstifadəçinin 17 yaşında olması da bəzi xidmətlərin 18+ tələbinə görə önəmlidir. Heç bir yaş və ya xidmət məhdudiyyətini keçməyə çalışma.

## 8. Nələri paylaşma və silmə

`.env.local`, `.env.staging.local`, `.local/vercel-auth`, admin/provider keys, private backups, keystore/upload signing, auth token/fixture session faylları başqa AI/cloud-a göndərilmir. Source, `.env.example` və konkret redacted error kifayətdir. `node_modules`, SDK/NDK, Gradle cache və generated Android output-u AI-yə context kimi vermə.

Mövcud versiyalı APK/screenshot və verification qeydlərini saxla. Köhnə dizayn board-ları screenshot və ya istifadəçi araşdırması deyil. Təmizlik edəndə əvvəl hansı faylın source, generated, cache və private backup olduğunu yoxla; recursive delete ilə bütün qovluğu kor-koranə silmə.

## 0.7 checkpoint

Historical 0.7 checkpoint: compact note review and monthly recap implemented. The subsequent 0.8 push implementation, approved project-scoped server sender identity, migration and scheduler are recorded in `mobile/docs/PUSH-2026-11-10.md`; do not recreate them. Public client config is in `mobile/google-services.json`. Private sender/scheduler credentials must stay out of the APK/archive/chat. A bounded local NVIDIA run subsequently passed 5 of 6 pipeline checks with one explicit game-setting case requiring review; `.local/mobile-0.7-nvidia-live.json`. It created no real-user content and verified disposable cleanup. This is partial transport/pipeline evidence, not complete AI quality or permission to enable free-tier development AI publicly. Google OAuth and exact current device evidence remain separately gated by VERIFICATION.
