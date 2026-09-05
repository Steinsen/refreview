# RefReview

Stängd app för basketdomare: ladda upp ett klipp direkt från mobilen eller datorn, skriv vad du vill att gruppen tittar på, och diskutera i kommentarer (gärna med tidpunkt, t.ex. `1:42`). Inloggning med en engångskod på e-post – vilken adress som helst, inget lösenord – och bara adresser som admin lagt till kommer in.

Kör på Cloudflare Workers + D1 + Stream. Videofilerna går direkt från webbläsaren till Cloudflare Stream (återupptagbar uppladdning, upp till 5 GB), transkodas för alla enheter och spelas bara upp med en signerad länk som appen skapar för inloggade användare. Inget byggsteg, inget ramverk i webbläsaren.

## Utseende
Appen använder Svensk Baskets färger (mörkblått + gult). Färgkoderna ligger som variabler längst upp i `src/views.ts` (`--sb-blue`, `--sb-yellow` m.fl.) – byt till de exakta värdena ur förbundets grafiska manual. Logotypen läggs som `public/logo.svg`, se `public/LOGOTYP.md`. Layouten är byggd för mobil först och skalar upp till dator.

## Uppsättning (ca 20 minuter, allt i webbläsaren)

### 1. E-post för inloggningskoder (Resend)
1. Skapa konto på <https://resend.com> (gratis upp till 3000 mejl/månad).
2. **Domains → Add domain** → t.ex. `steinsen.com` (eller en subdomän som `app.steinsen.com`). Lägg in DNS-posterna Resend visar hos den som sköter domänens DNS idag. E-posten i övrigt påverkas inte – det är bara avsändarrättigheter för den här appen.
3. **API Keys → Create** → spara som secret `RESEND_API_KEY` (steg 3.6 nedan).
4. Sätt `MAIL_FROM` i `wrangler.jsonc` till en adress på den verifierade domänen, t.ex. `RefReview <inloggning@steinsen.com>`.

Tills domänen är verifierad kan du testa med Resends testavsändare `onboarding@resend.dev`, men den skickar bara till din egen Resend-adress.

### 2. Cloudflare Stream
1. **Stream** i dashboarden → aktivera (kräver betalkort; ca 5 USD per 1000 lagrade minuter och 1 USD per 1000 visade minuter).
2. Under **Stream → Settings** hittar du din *customer code* (`customer-xxxx.cloudflarestream.com`) → skriv in i `wrangler.jsonc` som `STREAM_CUSTOMER_CODE`.
3. Skapa en API-token: **My Profile → API Tokens → Create Token → Custom** med behörigheten *Account → Stream → Edit*. Spara den som secret `CF_STREAM_API_TOKEN` (steg 3.6 nedan).
4. Ditt konto-ID står i högerkolumnen under Workers & Pages → `CF_ACCOUNT_ID` i `wrangler.jsonc`.

### 3. Cloudflare Workers + D1
1. Lägg koden i ett GitHub-repo.
2. I Cloudflare-dashboarden: **Workers & Pages → Create → Import a repository** → välj repot. Byggkommando kan lämnas tomt, deploy-kommando `npx wrangler deploy`.
3. **Storage & Databases → D1 → Create** → namn `refreview`. Kopiera **Database ID** och klistra in i `wrangler.jsonc` (`database_id`).
4. Öppna databasen → **Console** → klistra in innehållet i `migrations/0001_init.sql` och kör.
   (Alternativt `npx wrangler d1 migrations apply refreview --remote` om du kör wrangler lokalt.)
5. I `wrangler.jsonc`: sätt `ADMIN_EMAILS` till din Gmail-adress och `APP_URL` till workerns adress.
6. Under workerns **Settings → Variables and Secrets**, lägg till secrets:
   - `RESEND_API_KEY` – från steg 1.3
   - `SESSION_SECRET` – en lång slumpad sträng (t.ex. 40+ tecken)
   - `CF_STREAM_API_TOKEN` – från steg 2.3
7. Pusha till GitHub → Cloudflare deployar. Klart.

Varje push till main deployar en ny version automatiskt.

### 4. Första inloggningen och användare
Skriv in adressen du satte i `ADMIN_EMAILS` på inloggningssidan – du får en kod på mejlen och blir admin direkt. Första gången frågar appen efter ditt namn.

Under **Admin** klistrar du in domarnas e-postadresser. Det är hela användarhanteringen: står adressen på listan kan personen logga in, annars inte. "Stäng av" tar bort åtkomsten men behåller personens kommentarer; "Släpp in igen" ångrar.

Så loggar en domare in: skriver sin e-postadress → får en sexsiffrig kod (gäller 10 minuter, max 5 försök) → skriver in koden → inloggad i 30 dagar på den enheten.

## Hur domarna lägger upp klipp
**Lägg upp klipp** → välj videofil (fungerar direkt från kamerarullen på mobilen) → rubrik och kommentar → **Lägg upp**. Uppladdningen visar förlopp och återupptas om uppkopplingen bryts. Efter uppladdning bearbetar Stream filen i någon minut; sidan uppdaterar sig själv tills klippet går att spela.

Radering av ett klipp (admin) tar även bort filen hos Stream.

## Lokal utveckling
```
npm install
cp .dev.vars.example .dev.vars   # fyll i värden
npm run db:migrate:local
npm run dev
```
Med tom `RESEND_API_KEY` skrivs inloggningskoden ut i terminalen i stället för att mejlas.

## Struktur
```
src/index.ts    routes (klipp, kommentarer, admin)
src/auth.ts     Engångskod via e-post (Resend) + signerad sessionscookie (JWT, 30 dagar)
src/stream.ts   Cloudflare Stream-API (uppladdning, status, signerad token, radering)
src/views.ts    all HTML + CSS (färgvariabler längst upp)
public/         statiska filer: favicon, logotyp
migrations/     D1-schema
```

## Sådant som medvetet saknas i första versionen
- Redigera klipp/kommentarer (radera finns)
- Svar på kommentarer/trådar
- Notiser via e-post
- Grupper/kategorier (t.ex. per distrikt eller regelområde)
- Webhook från Stream när bearbetningen är klar (nu frågar appen Stream när någon öppnar klippsidan)
- Trimning av klipp – Stream har API för att klippa ut ett segment

Alla går att lägga till utan att ändra grundstrukturen.
