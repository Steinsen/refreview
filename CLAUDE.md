# RefReview – anvisningar för Claude Code

Stängd webbapp där basketdomare laddar upp matchklipp och diskuterar bedömningar i kommentarer. Målgruppen är svenska domare i utbildning; ägaren (Raggi) är admin. Prototypstadium – prioritera enkelhet och att saker fungerar över generalitet.

## Stack – ändra inte utan att fråga
- **Cloudflare Workers** med **Hono** (routing, HTML via `hono/html`, JWT, cookies)
- **D1** (SQLite) för användare, klipp, kommentarer, inloggningskoder
- **Cloudflare Stream** för video: direktuppladdning med tus från webbläsaren, signerade uppspelningslänkar
- **Resend** för inloggningsmejl
- Server-renderad HTML, ett CSS-block, ingen frontend-ramverk, inget byggsteg. Enda klient-JS: tus-uppladdning (`/ny`), auto-reload under bearbetning (`/klipp/:id`), `confirm()` vid radering.
- TypeScript strict. Ingen ORM, ingen validation-lib – prepared statements och manuella kontroller räcker.

## Filer
```
src/index.ts      alla routes + CSP-headers + hjälpfunktioner (parseTimestamp)
src/auth.ts       Env-typ, session (JWT HS256 i cookie rr_session, 30 dagar), engångskod, Resend, middleware
src/stream.ts     Stream-API: createTusUpload, getStatus, signedToken, deleteVideo, playerUrl
src/views.ts      alla sidor som funktioner som returnerar html``; CSS-konstant längst upp
migrations/       D1-schema, numrerade filer. Ny ändring = ny fil, redigera aldrig en körd migration
public/           statiska filer via assets-binding (favicon.svg, logo.svg läggs av ägaren)
wrangler.jsonc    bindings + vars; secrets sätts i dashboard/`wrangler secret put`
```

## Kommandon
```
npm install
cp .dev.vars.example .dev.vars        # RESEND_API_KEY tom lokalt → koden loggas i terminalen
npm run db:migrate:local
npm run dev                            # http://localhost:8787
npx tsc --noEmit                       # kör alltid innan du är klar
npm run db:migrate                     # remote, efter ny migration
```
Deploy sker via GitHub → Cloudflare Workers Builds vid push till main. Kör inte `wrangler deploy` manuellt om inte ägaren ber om det.

Lokalt röktest utan riktiga tjänster: sätt `database_id` tillfälligt till ett dummy-UUID, `CF_STREAM_API_TOKEN=x`, tom `RESEND_API_KEY`. Inloggningskoden syns i dev-loggen. Stream-anrop misslyckas lokalt – det är förväntat; testa uppladdning bara mot riktigt konto.

## Domänmodell
- `users`: `approved` = har tillgång (1) / avstängd (0). Användare skapas **bara** av admin (e-postlista) eller automatiskt för adresser i `ADMIN_EMAILS`. `name === email` betyder "har inte satt namn ännu" → middleware skickar till `/namn`.
- `videos.status`: `uploading` → `processing` → `ready` | `error`. Uppdateras när någon öppnar klippsidan (pollar Stream). `stream_uid` är nyckeln mot Stream. `customer_code` (för spelar-URL:en) läses ur Stream-svarets `preview`-fält och sparas per video – ingen konfig behövs.
- `comments.timestamp_s`: sekunder i klippet, null = ingen tidpunkt. Visas som `m:ss`.
- `login_codes`: hashad kod, 10 min, max 5 försök, en aktiv per e-post.

## Regler och konventioner
- **Svenska överallt** i UI, felmeddelanden, kommentarer i kod och commit-meddelanden. Routes på svenska (`/ny`, `/klipp/:id`, `/namn`, `/admin/bjud-in`).
- Alla routes utom `/login*` går genom `requireApproved`; admin-routes genom `requireAdmin`. Nya routes ska följa samma mönster.
- Videofiler får aldrig passera workern – alltid direktuppladdning till Stream.
- Uppspelning alltid via `signedToken` (kortlivad). Sätt inte `requireSignedURLs` till false.
- Ändrar du HTML som laddar externa resurser: uppdatera CSP i `src/index.ts` (`secureHeaders`).
- Formulär är vanliga POST med redirect efteråt (utom uppladdningens JSON-API under `/api/`). Håll det så.
- Design: Svensk Baskets färger via `--sb-*`-variabler, typsnitt Barlow, mobil först, tryckytor ≥ 44 px. Inga nya ramverk eller CSS-filer – utöka CSS-konstanten i `views.ts`.
- Sparar du användartext: `trim()` + `slice(max)` som i befintlig kod. Hono's `html` escapar automatiskt – använd `raw()` bara för CSS/JS-konstanter.
- Radering av klipp ska alltid även radera hos Stream (`deleteVideo`).

## Kända begränsningar / trolig backlog
Ordnat efter vad ägaren troligen vill ha först:
1. Stream-webhook för status (`ready`/`error`) i stället för polling på klippsidan
2. Redigera egen kommentar och eget klipps rubrik/beskrivning
3. Kategorier/taggar (regelområde, distrikt) och filtrering i listan
4. Svar på kommentarer (enkel trådning, `parent_id`)
5. Notiser via mejl när någon kommenterar ens klipp
6. Egen domän (steinsen.com ligger inte på Cloudflare ännu – `APP_URL` och Resend-avsändare påverkas)

Hoppa inte in på dessa på eget initiativ – fråga vad som ska göras.

## När du är klar med en ändring
1. `npx tsc --noEmit` grönt
2. Ny migration om schemat ändrats, och README uppdaterad om uppsättningen påverkas
3. Kort sammanfattning på svenska av vad som ändrats och vad ägaren behöver göra i dashboarden (nya secrets, DNS, etc.)
