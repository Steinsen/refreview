import { html, raw } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import type { User } from './auth'

type Video = {
  id: number
  title: string
  stream_uid: string
  status: string
  duration_s: number | null
  description: string
  created_at: string
  author: string
  comment_count?: number
}

type Comment = {
  id: number
  body: string
  timestamp_s: number | null
  created_at: string
  author: string
  user_id: number
  whistles: number
  my_whistle: number
}

const CSS = `
/* Svensk Basket-profil: byt till exakta koder från förbundets grafiska manual */
:root {
  --sb-blue: #0b2a5b;        /* mörkblå bas */
  --sb-blue-deep: #071d40;   /* ännu mörkare, för header-gradient/footer */
  --sb-yellow: #ffc628;      /* gul accent */
  --sb-yellow-ink: #0b2a5b;  /* text på gul knapp */
  --ink: #101828; --muted: #5a6577; --line: #d9dee7; --bg: #ffffff; --panel: #f2f5fa;
  --danger: #b3261e;
}
* { box-sizing: border-box; }
html { font-family: 'Barlow', system-ui, sans-serif; color: var(--ink); background: var(--bg); font-size: 17px; line-height: 1.45; -webkit-text-size-adjust: 100%; }
body { margin: 0; min-height: 100dvh; display: flex; flex-direction: column; }
a { color: var(--sb-blue); text-decoration: none; }
a:hover { text-decoration: underline; }
header.top { background: var(--sb-blue); color: #fff; border-bottom: 4px solid var(--sb-yellow); }
header.top .in { max-width: 960px; margin: 0 auto; padding: 10px 20px; display: flex; align-items: center; gap: 14px; min-height: 60px; }
header.top .brand { display: flex; align-items: center; gap: 12px; color: #fff; font-weight: 700; font-size: 1.2rem; letter-spacing: .01em; }
header.top .brand img { height: 36px; width: auto; display: block; }
header.top .brand:hover { text-decoration: none; }
header.top nav { margin-left: auto; display: flex; gap: 6px; font-size: .95rem; }
header.top nav a { color: #fff; padding: 8px 10px; border-radius: 4px; }
header.top nav a:hover { background: rgba(255,255,255,.12); text-decoration: none; }
main { max-width: 960px; width: 100%; margin: 0 auto; padding: 28px 20px 64px; flex: 1; }
footer.bottom { color: var(--muted); font-size: .85rem; text-align: center; padding: 20px; border-top: 1px solid var(--line); }
h1 { font-size: 1.9rem; line-height: 1.15; margin: 0 0 8px; font-weight: 700; letter-spacing: -.01em; color: var(--sb-blue); }
h2 { font-size: 1.15rem; margin: 32px 0 12px; font-weight: 600; }
p { margin: 0 0 12px; max-width: 64ch; }
.meta { color: var(--muted); font-size: .9rem; }
.btn { display: inline-block; background: var(--sb-yellow); color: var(--sb-yellow-ink); border: 0; padding: 10px 18px; font: inherit; font-weight: 700; cursor: pointer; border-radius: 4px; min-height: 44px; }
.btn:hover { filter: brightness(.95); text-decoration: none; }
.btn.quiet { background: transparent; color: var(--ink); border: 1.5px solid var(--line); font-weight: 600; }
.btn.danger { background: transparent; color: var(--danger); border: 1.5px solid var(--line); padding: 4px 10px; font-size: .85rem; font-weight: 600; min-height: 0; }
.btn:disabled { opacity: .6; cursor: default; }
input[type=text], input[type=email], input[type=password], input[type=url], textarea { width: 100%; font: inherit; padding: 10px 12px; border: 1.5px solid var(--line); border-radius: 4px; background: #fff; color: var(--ink); min-height: 44px; }
input:focus, textarea:focus, .btn:focus, a:focus-visible { outline: 3px solid var(--sb-yellow); outline-offset: 1px; }
textarea { min-height: 96px; resize: vertical; }
label { display: block; font-weight: 600; font-size: .92rem; margin: 14px 0 5px; }
.hint { color: var(--muted); font-size: .85rem; margin: 5px 0 0; }
.list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.list li { display: grid; grid-template-columns: 1fr auto; gap: 8px 20px; padding: 16px 0; border-bottom: 1px solid var(--line); }
.list li a.title { font-size: 1.15rem; font-weight: 600; color: var(--sb-blue); }
.list li .count { color: var(--muted); font-size: .9rem; white-space: nowrap; align-self: center; }
.player { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 4px; overflow: hidden; }
.player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.comments { list-style: none; margin: 0; padding: 0; }
.comments li { padding: 14px 0; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: 64px 1fr; gap: 14px; }
.comments .ts { font-weight: 700; color: var(--sb-blue); font-variant-numeric: tabular-nums; background: var(--panel); border-radius: 4px; text-align: center; padding: 2px 0; align-self: start; font-size: 1rem; font-family: inherit; border: 0; width: 100%; display: block; }
.comments .ts.none { color: var(--muted); background: transparent; }
button.ts { cursor: pointer; border: 1.5px solid transparent; min-height: 44px; }
button.ts:hover { background: var(--sb-yellow); color: var(--sb-yellow-ink); }
button.ts::after { content: '▸'; display: block; font-size: .7rem; line-height: 1; opacity: .6; }
.pipa { display: inline-flex; align-items: center; gap: 8px; background: transparent; border: 1.5px solid var(--line); color: var(--muted); border-radius: 999px; padding: 8px 16px; font: inherit; font-size: .9rem; font-weight: 600; cursor: pointer; min-height: 44px; margin-top: 10px; }
.pipa:hover { border-color: var(--sb-blue); color: var(--sb-blue); }
.pipa.given { background: var(--sb-yellow); border-color: var(--sb-yellow); color: var(--sb-yellow-ink); }
.pipa .antal { font-variant-numeric: tabular-nums; }
.tsval { font-weight: 700; font-size: 1.25rem; color: var(--sb-blue); font-variant-numeric: tabular-nums; }
.tsval.none { color: var(--muted); font-weight: 600; }
input[type=range] { width: 100%; accent-color: var(--sb-blue); height: 44px; }
.comments .body { white-space: pre-wrap; overflow-wrap: anywhere; }
.comments .who { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.empty { color: var(--muted); padding: 24px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.notice { background: var(--panel); padding: 14px 16px; border-left: 4px solid var(--sb-yellow); margin: 0 0 20px; }
.row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.row .grow { flex: 1 1 200px; }
table { width: 100%; border-collapse: collapse; font-size: .95rem; }
th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { font-weight: 600; color: var(--muted); }
.drop { border: 2px dashed var(--line); border-radius: 6px; padding: 28px 18px; text-align: center; color: var(--muted); cursor: pointer; }
.drop.has { border-style: solid; border-color: var(--sb-blue); color: var(--ink); }
.drop input { display: none; }
.progress { height: 10px; background: var(--panel); border-radius: 5px; overflow: hidden; margin-top: 14px; }
.progress > div { height: 100%; width: 0; background: var(--sb-blue); transition: width .2s; }
.processing { aspect-ratio: 16 / 9; background: var(--panel); display: grid; place-items: center; color: var(--muted); border-radius: 4px; text-align: center; padding: 20px; }
.login { max-width: 460px; margin: 40px auto; }
.login h1 { font-size: 2.4rem; }
@media (max-width: 600px) {
  html { font-size: 16px; }
  main { padding: 20px 16px 48px; }
  h1 { font-size: 1.6rem; }
  header.top .in { padding: 8px 14px; }
  header.top .brand { font-size: 1.05rem; }
  header.top .brand img { height: 30px; }
  header.top nav { gap: 0; font-size: .9rem; }
  header.top nav a { padding: 8px 8px; }
  .list li { grid-template-columns: 1fr; gap: 4px; }
  .comments li { grid-template-columns: 52px 1fr; gap: 10px; }
  .login { margin: 16px auto; }
  .login h1 { font-size: 2rem; }
  table { font-size: .9rem; }
  th:nth-child(1), td:nth-child(1) { display: none; } /* göm namnkolumnen på smal skärm */
}
@media (prefers-reduced-motion: no-preference) { .btn { transition: filter .12s; } }
`

export function layout(title: string, user: User | null, body: HtmlEscapedString | Promise<HtmlEscapedString>) {
  return html`<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b2a5b">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${title} – RefReview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&display=swap" rel="stylesheet">
<style>${raw(CSS)}</style>
</head>
<body>
<header class="top"><div class="in">
  <a class="brand" href="/"><img src="/logo.svg" alt="Svensk Basket" onerror="this.remove()"><span>RefReview</span></a>
  ${user ? html`<nav>
    <a href="/ny">Lägg upp klipp</a>
    ${user.is_admin ? html`<a href="/admin">Admin</a>` : ''}
    <a href="/losenord">Lösenord</a>
    <a href="/logout">Logga ut</a>
  </nav>` : ''}
</div></header>
<main>${body}</main>
<footer class="bottom">RefReview · Utbildningsverktyg för basketdomare</footer>
</body>
</html>`
}

export function loginPage(opts: { error?: string; info?: string; email?: string } = {}) {
  return layout('Logga in', null, html`
<div class="login">
  <h1>RefReview</h1>
  <p>Klipp och situationsdiskussioner för Svensk Baskets domare. Innehållet är stängt – du behöver en registreringskod för att skapa konto.</p>
  ${opts.error ? html`<div class="notice">${opts.error}</div>` : ''}
  ${opts.info ? html`<div class="notice">${opts.info}</div>` : ''}
  <form method="post" action="/login">
    <label for="email">E-postadress</label>
    <input type="email" id="email" name="email" required autocomplete="email" inputmode="email" placeholder="namn@exempel.se" value="${opts.email ?? ''}">
    <label for="password">Lösenord</label>
    <input type="password" id="password" name="password" required autocomplete="current-password">
    <p style="margin-top:16px"><button class="btn" type="submit">Logga in</button></p>
  </form>
  <p class="hint">Har du inget konto? <a href="/registrera">Skapa konto</a> med registreringskoden du fått.</p>

  <h2>Eller få en kod på mejlen</h2>
  <p class="hint">Fungerar bara om administratören lagt till din adress och mejlutskicket är igång.</p>
  <form method="post" action="/login/mejl">
    <label for="mejl">E-postadress</label>
    <input type="email" id="mejl" name="email" required autocomplete="email" inputmode="email" placeholder="namn@exempel.se">
    <p style="margin-top:16px"><button class="btn quiet" type="submit">Skicka inloggningskod</button></p>
  </form>
</div>`)
}

export function registerPage(
  opts: { error?: string; info?: string; needsCode: boolean; values?: { name?: string; email?: string } } = { needsCode: true },
) {
  const v = opts.values ?? {}
  return layout('Skapa konto', null, html`
<div class="login">
  <h1>Skapa konto</h1>
  <p>${opts.needsCode ? 'Du behöver registreringskoden som administratören delat ut. ' : ''}Nya konton godkänns av administratören innan de kommer in. Namnet visas vid dina klipp och kommentarer.</p>
  ${opts.info ? html`<div class="notice">${opts.info}</div>` : ''}
  ${opts.error ? html`<div class="notice">${opts.error}</div>` : ''}
  <form method="post" action="/registrera">
    <label for="name">Namn</label>
    <input type="text" id="name" name="name" required maxlength="80" autocomplete="name" placeholder="Förnamn Efternamn" value="${v.name ?? ''}">
    <label for="email">E-postadress</label>
    <input type="email" id="email" name="email" required autocomplete="email" inputmode="email" placeholder="namn@exempel.se" value="${v.email ?? ''}">
    <label for="password">Lösenord</label>
    <input type="password" id="password" name="password" required minlength="8" autocomplete="new-password">
    <p class="hint">Minst 8 tecken.</p>
    ${opts.needsCode
      ? html`<label for="code">Registreringskod</label>
    <input type="text" id="code" name="code" autocomplete="off" placeholder="Koden du fått av administratören">`
      : ''}
    <p style="margin-top:18px"><button class="btn" type="submit">Skapa konto</button></p>
  </form>
  <p class="hint">Har du redan ett konto? <a href="/login">Logga in</a>.</p>
</div>`)
}

export function codePage(email: string, error?: string) {
  return layout('Ange kod', null, html`
<div class="login">
  <h1>Kolla mejlen</h1>
  <p>Vi har skickat en sexsiffrig kod till <strong>${email}</strong>. Den gäller i tio minuter.</p>
  ${error ? html`<div class="notice">${error}</div>` : ''}
  <form method="post" action="/login/kod">
    <input type="hidden" name="email" value="${email}">
    <label for="code">Kod</label>
    <input type="text" id="code" name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" autofocus style="font-size:1.6rem;letter-spacing:.2em;max-width:220px">
    <p style="margin-top:16px"><button class="btn" type="submit">Logga in</button></p>
  </form>
  <p class="hint">Inget mejl? Titta i skräpposten, eller <a href="/login">be om en ny kod</a>.</p>
</div>`)
}

export function namePage(user: User, error?: string) {
  return layout('Ditt namn', user, html`
<div class="login">
  <h1>Vad heter du?</h1>
  <p>Namnet visas vid dina klipp och kommentarer så att kollegorna vet vem som skrivit.</p>
  ${error ? html`<div class="notice">${error}</div>` : ''}
  <form method="post" action="/namn">
    <label for="name">Namn</label>
    <input type="text" id="name" name="name" required maxlength="80" autocomplete="name" placeholder="Förnamn Efternamn" autofocus>
    <p style="margin-top:16px"><button class="btn" type="submit">Spara</button></p>
  </form>
</div>`)
}

export function passwordPage(user: User, opts: { hasPassword: boolean; error?: string; done?: boolean } = { hasPassword: true }) {
  return layout('Byt lösenord', user, html`
<div class="login">
  <h1>${opts.hasPassword ? 'Byt lösenord' : 'Välj lösenord'}</h1>
  <p>${opts.hasPassword
    ? 'Skriv ditt nuvarande lösenord och det nya du vill ha.'
    : 'Ditt konto har inget lösenord ännu – välj ett så kan du logga in med e-post och lösenord.'}</p>
  ${opts.error ? html`<div class="notice">${opts.error}</div>` : ''}
  ${opts.done ? html`<div class="notice">Lösenordet är ändrat.</div>` : ''}
  <form method="post" action="/losenord">
    ${opts.hasPassword
      ? html`<label for="current">Nuvarande lösenord</label>
    <input type="password" id="current" name="current" required autocomplete="current-password">`
      : ''}
    <label for="password">Nytt lösenord</label>
    <input type="password" id="password" name="password" required minlength="8" autocomplete="new-password">
    <p class="hint">Minst 8 tecken.</p>
    <label for="repeat">Nytt lösenord igen</label>
    <input type="password" id="repeat" name="repeat" required minlength="8" autocomplete="new-password">
    <p style="margin-top:18px"><button class="btn" type="submit">Spara lösenord</button></p>
  </form>
  <p class="hint"><a href="/">← Tillbaka till klippen</a></p>
</div>`)
}

export function indexPage(user: User, videos: Video[]) {
  return layout('Klipp', user, html`
<div class="row" style="margin-bottom:20px">
  <div class="grow"><h1>Klipp</h1><p class="meta">Senast upplagt först.</p></div>
  <a class="btn" href="/ny">Lägg upp klipp</a>
</div>
${videos.length === 0
  ? html`<div class="empty">Inga klipp ännu. Lägg upp det första – en situation, ett läge, en fråga till gruppen.</div>`
  : html`<ul class="list">${videos.map(
      (v) => html`<li>
        <div>
          <a class="title" href="/klipp/${v.id}">${v.title}</a>
          <div class="meta">${v.author} · ${fmtDate(v.created_at)}${v.duration_s ? html` · ${fmtTs(v.duration_s)}` : ''}${v.status !== 'ready' ? html` · <em>${statusText(v.status)}</em>` : ''}</div>
        </div>
        <div class="count">${v.comment_count ?? 0} ${v.comment_count === 1 ? 'kommentar' : 'kommentarer'}</div>
      </li>`,
    )}</ul>`}`)
}

export function newVideoPage(user: User, maxSeconds: number) {
  return layout('Lägg upp klipp', user, html`
<h1>Lägg upp klipp</h1>
<p>Filen laddas upp direkt från din enhet och bearbetas i några minuter innan den går att spela. Max ${Math.round(maxSeconds / 60)} minuter per klipp.</p>
<div class="notice" id="err" hidden></div>
<form id="f">
  <label for="title">Rubrik</label>
  <input type="text" id="title" name="title" required maxlength="140" placeholder="Blockering/charge, matchen Luleå–Umeå 2:a perioden">
  <label>Videofil</label>
  <label class="drop" id="drop" for="file">
    <span id="dropText">Välj eller släpp en videofil här</span>
    <input type="file" id="file" name="file" accept="video/*,.mov,.mp4" required>
  </label>
  <div class="progress" id="prog" hidden><div id="bar"></div></div>
  <p class="hint" id="progText"></p>
  <label for="description">Din kommentar</label>
  <textarea id="description" name="description" placeholder="Vad vill du att gruppen tittar på? Vad dömde du och varför?"></textarea>
  <p style="margin-top:18px"><button class="btn" type="submit" id="go">Lägg upp</button></p>
</form>
<script src="https://cdn.jsdelivr.net/npm/tus-js-client@4.1.0/dist/tus.min.js"></script>
<script>
(function () {
  var f = document.getElementById('f'), file = document.getElementById('file'), drop = document.getElementById('drop');
  var dropText = document.getElementById('dropText'), err = document.getElementById('err');
  var prog = document.getElementById('prog'), bar = document.getElementById('bar'), progText = document.getElementById('progText'), go = document.getElementById('go');
  function fmtMB(b) { return (b / 1048576).toFixed(b > 104857600 ? 0 : 1) + ' MB'; }
  function showFile() { if (file.files[0]) { dropText.textContent = file.files[0].name + ' (' + fmtMB(file.files[0].size) + ')'; drop.classList.add('has'); } }
  file.addEventListener('change', showFile);
  ['dragenter','dragover'].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); }); });
  drop.addEventListener('drop', function (ev) { ev.preventDefault(); if (ev.dataTransfer.files[0]) { file.files = ev.dataTransfer.files; showFile(); } });
  function fail(msg) { err.textContent = msg; err.hidden = false; go.disabled = false; prog.hidden = true; progText.textContent = ''; }

  f.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    err.hidden = true;
    var vf = file.files[0];
    if (!vf) return fail('Välj en videofil först.');
    go.disabled = true; prog.hidden = false; bar.style.width = '0%'; progText.textContent = 'Förbereder…';
    var body = { title: document.getElementById('title').value, description: document.getElementById('description').value, size: vf.size, filename: vf.name };
    var res = await fetch('/api/uppladdning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) return fail((await res.text()) || 'Kunde inte starta uppladdningen.');
    var info = await res.json();
    var upload = new tus.Upload(vf, {
      uploadUrl: info.uploadUrl,
      chunkSize: 50 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      metadata: { filename: vf.name, filetype: vf.type },
      onError: function (e) { fail('Uppladdningen misslyckades: ' + (e && e.message ? e.message : e) + '. Försök igen – den fortsätter där den slutade.'); },
      onProgress: function (sent, total) { var p = Math.round(sent / total * 100); bar.style.width = p + '%'; progText.textContent = 'Laddar upp ' + p + ' % (' + fmtMB(sent) + ' av ' + fmtMB(total) + ')'; },
      onSuccess: async function () { progText.textContent = 'Klart, bearbetar…'; await fetch('/api/uppladdning/' + info.videoId + '/klar', { method: 'POST' }); location.href = '/klipp/' + info.videoId; }
    });
    upload.start();
  });
})();
</script>`)
}

/** Visselpipa: munstycke + rund kropp + hål. Ärver färg från knappen. */
const VISSELPIPA = html`<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" style="flex:none">
  <rect x="1.5" y="8" width="11" height="7" rx="2.2" fill="currentColor"></rect>
  <circle cx="15" cy="12.5" r="6.5" fill="currentColor"></circle>
  <circle cx="15" cy="12.5" r="2.1" fill="currentColor" opacity=".35"></circle>
</svg>`

export function videoPage(user: User, video: Video, comments: Comment[], playerUrl: string | null, error?: string) {
  // Tidpunkter går att klicka på först när spelaren finns och vi vet hur lång videon är
  const kanValjaTid = !!playerUrl && !!video.duration_s
  return layout(video.title, user, html`
<p class="meta"><a href="/">← Alla klipp</a></p>
<h1>${video.title}</h1>
<p class="meta">Upplagt av ${video.author} · ${fmtDate(video.created_at)}</p>
${playerUrl
  ? html`<div class="player" id="spelare" style="margin:18px 0">
  <iframe id="ram" src="${playerUrl}" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${video.title}"></iframe>
</div>`
  : video.status === 'error'
    ? html`<div class="processing" style="margin:18px 0">Videon kunde inte bearbetas. Filen kan vara skadad eller för lång – testa att ladda upp den igen.</div>`
    : html`<div class="processing" style="margin:18px 0"><div>${statusText(video.status)}<br><span class="hint">Sidan uppdateras automatiskt.</span></div></div>
<script>setTimeout(function(){location.reload()}, 8000)</script>`}
${video.description ? html`<p style="white-space:pre-wrap">${video.description}</p>` : ''}

<h2 id="kommentarer">Kommentarer</h2>
${comments.length === 0
  ? html`<div class="empty">Inga kommentarer ännu.</div>`
  : html`<ul class="comments">${comments.map(
      (k) => html`<li id="kommentar-${k.id}">
        ${k.timestamp_s != null && kanValjaTid
          ? html`<button type="button" class="ts" data-ts="${k.timestamp_s}" title="Hoppa till ${fmtTs(k.timestamp_s)} i klippet">${fmtTs(k.timestamp_s)}</button>`
          : html`<div class="ts ${k.timestamp_s == null ? 'none' : ''}">${k.timestamp_s == null ? '—' : fmtTs(k.timestamp_s)}</div>`}
        <div>
          <div class="who"><strong>${k.author}</strong><span class="meta">${fmtDate(k.created_at)}
            ${k.user_id === user.id || user.is_admin
              ? html` <form method="post" action="/kommentar/${k.id}/radera" style="display:inline"><button class="btn danger" type="submit" onclick="return confirm('Radera kommentaren?')">Radera</button></form>`
              : ''}</span></div>
          <div class="body">${k.body}</div>
          <form method="post" action="/kommentar/${k.id}/visselpipa">
            <button class="pipa ${k.my_whistle ? 'given' : ''}" type="submit"
              aria-pressed="${k.my_whistle ? 'true' : 'false'}"
              title="${k.my_whistle ? 'Du har blåst i pipan – klicka för att ta tillbaka' : 'Blås i pipan om du håller med'}">
              ${VISSELPIPA}<span class="antal">${k.whistles}</span>
            </button>
          </form>
        </div>
      </li>`,
    )}</ul>`}

${error ? html`<div class="notice" style="margin-top:20px">${error}</div>` : ''}
<form method="post" action="/klipp/${video.id}/kommentar" style="margin-top:24px" id="kform" data-langd="${video.duration_s ?? 0}">
  ${kanValjaTid
    ? html`<label for="tsRange">Tidpunkt i klippet</label>
  <div class="row" style="gap:16px">
    <div class="tsval none" id="tsText" aria-live="polite">Ingen tidpunkt</div>
    <div class="grow"><input type="range" id="tsRange" min="0" max="${video.duration_s}" step="1" value="0" aria-label="Välj tidpunkt i klippet"></div>
  </div>
  <div class="row" style="gap:8px;margin-top:4px">
    <button type="button" class="btn quiet" id="tsNu">Använd spelarens tid</button>
    <button type="button" class="btn quiet" id="tsRensa">Ingen tidpunkt</button>
  </div>
  <input type="hidden" name="ts" id="ts" value="">
  <p class="hint">Dra i reglaget eller pausa i spelaren och tryck "Använd spelarens tid". Klippet är ${fmtTs(video.duration_s!)} långt.</p>`
    : html`<label for="ts">Tidpunkt</label>
  <input type="text" id="ts" name="ts" placeholder="1:42" pattern="^\\d{1,2}(:\\d{2}){1,2}$" inputmode="numeric" style="max-width:120px">
  <p class="hint">Tidpunkt är valfri – skriv t.ex. 1:42 för att peka på ett läge i klippet.</p>`}
  <label for="body">Kommentar</label>
  <textarea id="body" name="body" required maxlength="4000" style="min-height:76px"></textarea>
  <p style="margin-top:14px"><button class="btn" type="submit">Kommentera</button></p>
</form>
${user.is_admin
  ? html`<p style="margin-top:40px"><form method="post" action="/klipp/${video.id}/radera"><button class="btn danger" type="submit" onclick="return confirm('Radera klippet och alla kommentarer?')">Radera klippet</button></form></p>`
  : ''}
${playerUrl
  ? html`<script src="https://embed.cloudflarestream.com/embed/sdk.latest.js"></script>
<script>
(function () {
  var ram = document.getElementById('ram');
  var spelare = null;
  try { if (ram && window.Stream) spelare = Stream(ram); } catch (e) {}

  function fmt(s) {
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sek = Math.floor(s % 60);
    var mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(sek).padStart(2, '0');
  }

  // Klicka på en tidpunkt: hoppa dit och pausa
  function hoppa(t) {
    if (spelare) {
      spelare.currentTime = t;
      spelare.pause();
    } else if (ram) {
      // Utan spelar-SDK: ladda om iframen med starttiden i adressen
      var url = ram.src.split('#')[0].replace(/([?&])startTime=[^&]*/, '$1');
      ram.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'startTime=' + t + 's';
    }
    var ruta = document.getElementById('spelare');
    if (ruta) ruta.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  Array.prototype.forEach.call(document.querySelectorAll('button.ts[data-ts]'), function (el) {
    el.addEventListener('click', function () { hoppa(Number(el.getAttribute('data-ts'))); });
  });

  // Välj tidpunkt till en ny kommentar
  var range = document.getElementById('tsRange'), dolt = document.getElementById('ts');
  var text = document.getElementById('tsText'), nu = document.getElementById('tsNu'), rensa = document.getElementById('tsRensa');
  if (range && dolt && text) {
    var langd = Number(document.getElementById('kform').getAttribute('data-langd')) || 0;
    function satt(t, aktiv) {
      t = Math.max(0, Math.min(langd, Math.round(t)));
      range.value = t;
      dolt.value = aktiv ? t : '';
      text.textContent = aktiv ? fmt(t) : 'Ingen tidpunkt';
      text.className = aktiv ? 'tsval' : 'tsval none';
    }
    range.addEventListener('input', function () { satt(Number(range.value), true); });
    if (rensa) rensa.addEventListener('click', function () { satt(0, false); });
    if (nu) nu.addEventListener('click', function () {
      if (!spelare) return satt(Number(range.value), true);
      Promise.resolve(spelare.currentTime).then(function (t) { satt(Number(t) || 0, true); });
    });
  }
})();
</script>`
  : ''}`)
}

export function adminPage(
  user: User,
  users: User[],
  opts: { added?: number; error?: string; info?: string; registrationCode?: string } = {},
) {
  const { added, error, info, registrationCode } = opts
  const waiting = users.filter((u) => !u.approved && u.pending)
  const active = users.filter((u) => u.approved)
  const blocked = users.filter((u) => !u.approved && !u.pending)
  const rows = (list: User[], kind: 'vantar' | 'aktiv' | 'nekad') => html`<table>
    <thead><tr><th>Namn</th><th>E-post</th><th>Roll</th><th></th></tr></thead>
    <tbody>${list.map(
      (u) => html`<tr>
        <td>${u.name === u.email ? html`<span class="meta">Har inte loggat in ännu</span>` : u.name}</td><td>${u.email}</td><td>${u.is_admin ? 'Admin' : 'Domare'}${u.password_hash || kind !== 'aktiv' ? '' : html` <span class="meta">(inget lösenord)</span>`}</td>
        <td style="text-align:right">
          ${u.id === user.id
            ? html`<form method="post" action="/admin/${u.id}/nollstall-losenord" style="display:inline"><button class="btn danger" type="submit" onclick="return confirm('Nollställa ditt eget lösenord? Du loggas ut och får välja ett nytt lösenord på registreringssidan med samma e-postadress.')">Nollställ mitt lösenord</button></form>`
            : kind === 'vantar'
              ? html`<form method="post" action="/admin/${u.id}/godkann" style="display:inline"><button class="btn" type="submit" style="padding:5px 12px;font-size:.9rem">Godkänn</button></form>
                <form method="post" action="/admin/${u.id}/stang" style="display:inline"><button class="btn danger" type="submit">Neka</button></form>`
              : kind === 'aktiv'
                ? html`${u.password_hash
                    ? html`<form method="post" action="/admin/${u.id}/nollstall-losenord" style="display:inline"><button class="btn danger" type="submit" onclick="return confirm('Nollställa lösenordet? Personen får skapa konto på nytt med samma adress.')">Nollställ lösenord</button></form> `
                    : ''}<form method="post" action="/admin/${u.id}/stang" style="display:inline"><button class="btn danger" type="submit">Stäng av</button></form>`
                : html`<form method="post" action="/admin/${u.id}/godkann" style="display:inline"><button class="btn" type="submit" style="padding:5px 12px;font-size:.9rem">Släpp in</button></form>`}
        </td>
      </tr>`,
    )}</tbody></table>`
  return layout('Admin', user, html`
<h1>Användare</h1>
${error ? html`<div class="notice">${error}</div>` : ''}
${info ? html`<div class="notice">${info}</div>` : ''}
${added ? html`<div class="notice">${added} ${added === 1 ? 'adress tillagd' : 'adresser tillagda'}.</div>` : ''}

<h2>Väntar på godkännande (${waiting.length})</h2>
${waiting.length
  ? html`<p>De här har skapat konto men kommer inte in förrän du godkänner dem.</p>${rows(waiting, 'vantar')}`
  : html`<div class="empty">Ingen väntar just nu.</div>`}

<h2>Har tillgång (${active.length})</h2>
${rows(active, 'aktiv')}
${blocked.length ? html`<h2>Nekade och avstängda (${blocked.length})</h2>${rows(blocked, 'nekad')}` : ''}

<h2>Bjud in direkt</h2>
<p>Adresser du lägger till här slipper både registreringskod och godkännande – de kan skapa lösenord på <a href="/registrera">/registrera</a> och kommer in på en gång. Flera adresser går bra – en per rad eller med komma emellan.</p>
<form method="post" action="/admin/bjud-in">
  <label for="emails">E-postadresser</label>
  <textarea id="emails" name="emails" required placeholder="anna@gmail.com&#10;erik@hotmail.com" style="min-height:80px"></textarea>
  <p style="margin-top:12px"><button class="btn" type="submit">Lägg till</button></p>
</form>

<h2>Registreringskod</h2>
${registrationCode
  ? html`<p>Domare som inte står på listan ovan måste ange den här koden för att ens få skapa konto. Sedan hamnar de i kön.</p>
<p class="notice" style="font-size:1.4rem;font-weight:700;letter-spacing:.05em">${registrationCode}</p>
<p class="hint">Byt kod genom att ändra secreten <code>REGISTRATION_CODE</code> under workerns Settings → Variables and Secrets.</p>`
  : html`<div class="notice">Ingen registreringskod är satt. Vem som helst kan då fylla i registreringsformuläret, men ingen kommer in utan att du godkänner. Sätt secreten <code>REGISTRATION_CODE</code> under workerns Settings → Variables and Secrets om du vill ha ett filter före kön.</div>`}

<p class="hint" style="margin-top:20px">"Stäng av" och "Neka" tar bort åtkomsten men behåller personens klipp och kommentarer. "Nollställ lösenord" används när någon glömt sitt: personen skapar då konto på nytt med samma adress. Adresser i ADMIN_EMAILS i wrangler.jsonc blir alltid admin.</p>`)
}

function fmtDate(s: string) {
  // SQLite datetime('now') är UTC utan tidszon
  const d = new Date(s.replace(' ', 'T') + 'Z')
  return d.toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm' })
}

function statusText(status: string) {
  return status === 'uploading' ? 'Laddas upp…' : status === 'processing' ? 'Bearbetas…' : status === 'error' ? 'Fel vid bearbetning' : ''
}

function fmtTs(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return (h ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`
}
