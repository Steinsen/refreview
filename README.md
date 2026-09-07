# RefReview

Stängd app för basketdomare: ladda upp ett klipp direkt från mobilen eller datorn, skriv vad du vill att gruppen tittar på, och diskutera i kommentarer med tidpunkt – klicka på tidpunkten så hoppar spelaren dit och pausar. Håller du med om en kommentar blåser du i visselpipan på den. Domarna skapar konto själva med e-post och lösenord – inget mejlutskick behövs. Nya konton hamnar i en kö och kommer in först när admin godkänner dem; en valfri **registreringskod** kan sättas som filter före kön. Engångskod på mejl finns kvar som alternativ när Resend är uppsatt.

Kör på Cloudflare Workers + D1 + Stream. Videofilerna går direkt från webbläsaren till Cloudflare Stream (återupptagbar uppladdning, upp till 5 GB), transkodas för alla enheter och spelas bara upp med en signerad länk som appen skapar för inloggade användare. Inget byggsteg, inget ramverk i webbläsaren.

## Utseende
Appen använder Svensk Baskets färger (mörkblått + gult). Färgkoderna ligger som variabler längst upp i `src/views.ts` (`--sb-blue`, `--sb-yellow` m.fl.) – byt till de exakta värdena ur förbundets grafiska manual. Logotypen läggs som `public/logo.svg`, se `public/LOGOTYP.md`. Layouten är byggd för mobil först och skalar upp till dator.

## Uppsättning (ca 20 minuter, allt i webbläsaren)

### 1. E-post för inloggningskoder (Resend) – valfritt
Behövs bara om du vill kunna logga in med engångskod på mejl. Registrering och inloggning med lösenord fungerar utan det här steget.

1. Skapa konto på <https://resend.com> (gratis upp till 3000 mejl/månad).
2. **Domains → Add domain** → t.ex. `steinsen.com` (eller en subdomän som `app.steinsen.com`). Lägg in DNS-posterna Resend visar hos den som sköter domänens DNS idag. E-posten i övrigt påverkas inte – det är bara avsändarrättigheter för den här appen.
3. **API Keys → Create** → spara som secret `RESEND_API_KEY` (steg 3.6 nedan).
4. Sätt `MAIL_FROM` i `wrangler.jsonc` till en adress på den verifierade domänen, t.ex. `RefReview <inloggning@steinsen.com>`.

Tills domänen är verifierad kan du testa med Resends testavsändare `onboarding@resend.dev`, men den skickar bara till din egen Resend-adress.

### 2. Cloudflare Stream
1. **Stream** i dashboarden → aktivera (kräver betalkort; ca 5 USD per 1000 lagrade minuter och 1 USD per 1000 visade minuter).
2. Skapa en API-token: **My Profile → API Tokens → Create Token → Custom** med behörigheten *Account → Stream → Edit*. Spara den som secret `CF_STREAM_API_TOKEN` (steg 3.6 nedan).
3. Ditt konto-ID står i högerkolumnen under Workers & Pages (eller i adressfältet: `dash.cloudflare.com/<konto-id>/...`) → `CF_ACCOUNT_ID` i `wrangler.jsonc`.

Ingen "customer code" behöver konfigureras – appen läser den från Stream-API:t automatiskt.

### 3. Cloudflare Workers + D1
1. Lägg koden i ett GitHub-repo.
2. I Cloudflare-dashboarden: **Workers & Pages → Create → Import a repository** → välj repot. Byggkommando kan lämnas tomt, deploy-kommando `npx wrangler deploy`.
3. **Storage & Databases → D1 → Create** → namn `refreview`. Kopiera **Database ID** och klistra in i `wrangler.jsonc` (`database_id`).
4. Öppna databasen → **Console** → klistra in innehållet i `migrations/0001_init.sql` och kör.
   (Alternativt `npx wrangler d1 migrations apply refreview --remote` om du kör wrangler lokalt.)
5. I `wrangler.jsonc`: sätt `ADMIN_EMAILS` till din Gmail-adress och `APP_URL` till workerns adress.
6. Under workerns **Settings → Variables and Secrets**, lägg till secrets:
   - `SESSION_SECRET` – en lång slumpad sträng (t.ex. 40+ tecken)
   - `REGISTRATION_CODE` – valfri. Sätts den måste domarna ange koden för att få skapa konto (de hamnar sedan i godkännandekön ändå). Sätts den inte kan vem som helst fylla i formuläret, men ingen kommer in utan ditt godkännande.
   - `CF_STREAM_API_TOKEN` – från steg 2.2
   - `RESEND_API_KEY` – från steg 1.3 (valfritt, bara för inloggning med mejlad kod)
7. Pusha till GitHub → Cloudflare deployar. Klart.

Varje push till main deployar en ny version automatiskt.

### 4. Första inloggningen och användare
Gå till `/registrera` och skapa konto med adressen du satte i `ADMIN_EMAILS`. Adresser i `ADMIN_EMAILS` behöver ingen registreringskod och blir admin direkt. Adminsidan ligger sedan på `/admin` (och som **Admin** i menyn högst upp).

Så kommer en domare in: **Skapa konto** → namn, e-post, lösenord (och registreringskoden om du satt en) → kontot hamnar i kö → du godkänner det under **Admin** → personen loggar in med e-post och lösenord, och är inloggad i 30 dagar på den enheten.

Vill du slippa godkänna en och en: lägg in adresserna under **Admin → Bjud in direkt**. De slipper både registreringskod och kö och kommer in så fort de satt ett lösenord.

Under **Admin** finns:
- **Väntar på godkännande** – Godkänn eller Neka varje nytt konto.
- **Har tillgång** – "Stäng av" tar bort åtkomsten men behåller personens klipp och kommentarer. "Nollställ lösenord" används när någon glömt sitt: personen skapar då konto på nytt med samma adress och behåller allt sitt innehåll.
- **Nekade och avstängda** – "Släpp in" ångrar.
- **Din egen rad** – "Nollställ mitt lösenord" loggar ut dig och låter dig välja ett nytt på `/registrera` med samma adress. Fungerar eftersom din adress står i `ADMIN_EMAILS` och därför slipper både registreringskod och kö. Vill du bara byta lösenord och kan ditt nuvarande: använd **Lösenord** i menyn i stället.
- **Registreringskoden**, om du satt en, så du kan kopiera den till domarna. Byt kod genom att ändra secreten `REGISTRATION_CODE`; redan skapade konton påverkas inte.

Alla inloggade byter sitt eget lösenord under **Lösenord** i menyn (`/losenord`) – nuvarande lösenord krävs.

### Om du blir utelåst
Har du glömt admin-lösenordet kommer du inte in för att kunna nollställa det. Nollställ det då direkt i databasen: **Storage & Databases → D1 → refreview → Console**:
```sql
UPDATE users SET password_hash = NULL WHERE email = 'din@adress.se';
```
Gå sedan till `/registrera` och välj ett nytt lösenord med samma adress. Allt ditt innehåll finns kvar. Samma sak från terminalen:
```
npx wrangler d1 execute refreview --remote --command "UPDATE users SET password_hash = NULL WHERE email = 'din@adress.se'"
```

Är Resend uppsatt finns även den gamla vägen in längst ned på inloggningssidan: skriv e-postadressen → sexsiffrig kod på mejlen (gäller 10 minuter, max 5 försök). Den fungerar bara för adresser som redan finns i användarlistan.

## Kommentarer, tidpunkter och visselpipor
Under klippet väljer du tidpunkt med ett reglage som går från början till slutet av videon, eller pausar i spelaren och trycker **Använd spelarens tid**. **Ingen tidpunkt** gör kommentaren allmän. Tidpunkten till vänster om varje kommentar går att klicka på: spelaren hoppar dit och pausar.

**Visselpipan** under varje kommentar är ett "jag håller med" på domarspråk. Klicka en gång för att blåsa, en gång till för att ta tillbaka – en pipa per person och kommentar, och antalet syns på knappen.

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
src/auth.ts     Registrering + lösenord (PBKDF2), engångskod via e-post (Resend), sessionscookie (JWT, 30 dagar)
src/stream.ts   Cloudflare Stream-API (uppladdning, status, signerad token, radering)
src/views.ts    all HTML + CSS (färgvariabler längst upp)
public/         statiska filer: favicon, logotyp
migrations/     D1-schema
```

## Sådant som medvetet saknas i första versionen
- Glömt lösenord-flöde som användaren klarar själv (admin nollställer i stället)
- Bromsning av upprepade lösenordsgissningar
- Att nollställa ett lösenord loggar inte ut redan inloggade enheter – sessionen gäller i 30 dagar oavsett (avstängning slår däremot igenom direkt)
- Redigera klipp/kommentarer (radera finns)
- Svar på kommentarer/trådar
- Notiser via e-post
- Grupper/kategorier (t.ex. per distrikt eller regelområde)
- Webhook från Stream när bearbetningen är klar (nu frågar appen Stream när någon öppnar klippsidan)
- Trimning av klipp – Stream har API för att klippa ut ett segment

Alla går att lägga till utan att ändra grundstrukturen.
