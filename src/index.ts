import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import {
  type App,
  type User,
  loadUser,
  requireApproved,
  requireAdmin,
  requestCode,
  verifyCode,
  register,
  loginWithPassword,
  registrationCode,
  isAdminEmail,
  normalizeEmail,
  isValidEmail,
  logout,
  MIN_PASSWORD,
} from './auth'
import { loginPage, registerPage, codePage, namePage, indexPage, newVideoPage, videoPage, adminPage } from './views'
import { createTusUpload, getStatus, signedToken, deleteVideo, playerUrl } from './stream'

const app = new Hono<App>()

app.use(
  '*',
  secureHeaders({
    // Tillåt Stream-spelaren i iframe, tus-klienten och Google Fonts
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      frameSrc: ['https://*.cloudflarestream.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ['https://fonts.gstatic.com'],
      scriptSrc: ["'unsafe-inline'", 'https://cdn.jsdelivr.net'], // tus-klient + små inline-skript
      connectSrc: ["'self'", 'https://*.cloudflarestream.com', 'https://upload.cloudflarestream.com'],
      formAction: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      frameAncestors: ["'none'"],
    },
  }),
)
app.use('*', loadUser)

// ---------- Inloggning och registrering ----------
app.get('/login', (c) => {
  const u = c.get('user')
  if (u?.approved) return c.redirect('/')
  const fel = c.req.query('fel')
  return c.html(
    loginPage({
      error: fel === 'avstangd' ? 'Ditt konto är avstängt. Kontakta administratören.' : undefined,
      info: c.req.query('info') === 'utloggad' ? 'Du är utloggad.' : undefined,
    }),
  )
})

/** Inloggning med lösenord. */
app.post('/login', async (c) => {
  const form = await c.req.parseBody()
  const email = normalizeEmail(String(form.email ?? ''))
  const password = String(form.password ?? '')
  if (!isValidEmail(email) || !password) return c.html(loginPage({ error: 'Fyll i e-postadress och lösenord.', email }), 400)
  const result = await loginWithPassword(c, email, password)
  if (result === 'ok') return c.redirect('/')
  if (result === 'avstangd') return c.html(loginPage({ error: 'Ditt konto är avstängt. Kontakta administratören.', email }), 403)
  if (result === 'inget_losenord')
    return c.html(loginPage({ error: 'Adressen har inget lösenord ännu. Skapa konto i stället.', email }), 400)
  return c.html(loginPage({ error: 'Fel e-postadress eller lösenord.', email }), 401)
})

app.get('/registrera', (c) => {
  const u = c.get('user')
  if (u?.approved) return c.redirect('/')
  return c.html(registerPage({ needsCode: !!registrationCode(c.env) }))
})

app.post('/registrera', async (c) => {
  const form = await c.req.parseBody()
  const name = String(form.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
  const email = normalizeEmail(String(form.email ?? ''))
  const password = String(form.password ?? '')
  const code = String(form.code ?? '')
  const needsCode = !!registrationCode(c.env) && !isAdminEmail(c.env, email)
  const back = (error: string, status: 400 | 403 | 409) =>
    c.html(registerPage({ error, needsCode, values: { name, email } }), status)

  if (name.length < 2) return back('Skriv ditt namn.', 400)
  if (!isValidEmail(email)) return back('Skriv en giltig e-postadress.', 400)
  if (password.length < MIN_PASSWORD) return back(`Lösenordet måste vara minst ${MIN_PASSWORD} tecken.`, 400)
  if (password.length > 200) return back('Lösenordet är för långt.', 400)

  const result = await register(c, { name, email, password, code })
  if (result === 'ok') return c.redirect('/')
  if (result === 'finns_redan') return back('Adressen har redan ett konto. Logga in i stället.', 409)
  if (result === 'fel_kod') return back('Fel registreringskod. Kontrollera med den som bjöd in dig.', 403)
  if (result === 'avstangd') return back('Adressen är avstängd. Kontakta administratören.', 403)
  return back('Registrering är inte öppen ännu. Be administratören om en registreringskod.', 403)
})

/** Alternativ väg in: engångskod på mejl (kräver att Resend är uppsatt). */
app.post('/login/mejl', async (c) => {
  const form = await c.req.parseBody()
  const email = normalizeEmail(String(form.email ?? ''))
  if (!isValidEmail(email)) return c.html(loginPage({ error: 'Skriv en giltig e-postadress.' }), 400)
  const result = await requestCode(c.env, email)
  if (result === 'not_allowed')
    return c.html(loginPage({ error: `${email} finns inte med bland dem som har tillgång. Skapa konto med registreringskod i stället.` }), 403)
  if (result === 'send_failed')
    return c.html(loginPage({ error: 'Kunde inte skicka mejlet just nu. Logga in med lösenord eller skapa konto i stället.' }), 502)
  return c.html(codePage(email))
})

app.post('/login/kod', async (c) => {
  const form = await c.req.parseBody()
  const email = normalizeEmail(String(form.email ?? ''))
  const code = String(form.code ?? '')
  if (!isValidEmail(email)) return c.redirect('/login')
  const result = await verifyCode(c, email, code)
  if (result === 'ok') return c.redirect('/')
  if (result === 'wrong') return c.html(codePage(email, 'Fel kod. Kontrollera siffrorna och försök igen.'), 400)
  if (result === 'locked') return c.html(loginPage({ error: 'För många felaktiga försök. Begär en ny kod.' }), 429)
  return c.html(loginPage({ error: 'Koden har gått ut eller använts. Begär en ny.' }), 400)
})

app.get('/logout', (c) => logout(c))

// Första gången: be om namn (innan dess är namnet = e-postadressen)
app.use('*', async (c, next) => {
  const u = c.get('user')
  const p = c.req.path
  if (u?.approved && u.name === u.email && !p.startsWith('/namn') && p !== '/logout' && !p.startsWith('/api/')) {
    return c.redirect('/namn')
  }
  await next()
})
app.get('/namn', requireApproved, (c) => c.html(namePage(c.get('user')!)))
app.post('/namn', requireApproved, async (c) => {
  const user = c.get('user')!
  const form = await c.req.parseBody()
  const name = String(form.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
  if (name.length < 2) return c.html(namePage(user, 'Skriv ditt namn.'), 400)
  await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run()
  return c.redirect('/')
})

// ---------- Klipp ----------
app.get('/', requireApproved, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.title, v.status, v.duration_s, v.created_at, u.name AS author,
            (SELECT COUNT(*) FROM comments k WHERE k.video_id = v.id) AS comment_count
     FROM videos v JOIN users u ON u.id = v.user_id
     ORDER BY v.created_at DESC LIMIT 200`,
  ).all()
  return c.html(indexPage(c.get('user')!, results as any))
})

app.get('/ny', requireApproved, (c) => c.html(newVideoPage(c.get('user')!, Number(c.env.STREAM_MAX_SECONDS || 1800))))

/** Steg 1: skapar videoraden och en direktuppladdnings-URL hos Stream. */
app.post('/api/uppladdning', requireApproved, async (c) => {
  const user = c.get('user')!
  const body = (await c.req.json().catch(() => ({}))) as { title?: string; description?: string; size?: number; filename?: string }
  const title = String(body.title ?? '').trim().slice(0, 140)
  const description = String(body.description ?? '').trim().slice(0, 4000)
  const size = Number(body.size)
  if (!title) return c.text('Rubrik saknas.', 400)
  if (!Number.isFinite(size) || size <= 0) return c.text('Ogiltig filstorlek.', 400)
  if (size > 5 * 1024 ** 3) return c.text('Filen är större än 5 GB.', 400)

  let up
  try {
    up = await createTusUpload(c.env, { sizeBytes: size, name: title, creator: user.email })
  } catch (e) {
    console.error(e)
    return c.text('Kunde inte starta uppladdningen mot Cloudflare Stream. Kontrollera CF_ACCOUNT_ID och API-token.', 502)
  }
  const res = await c.env.DB.prepare(
    'INSERT INTO videos (title, stream_uid, status, description, user_id) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(title, up.uid, 'uploading', description, user.id)
    .run()
  return c.json({ videoId: res.meta.last_row_id, uploadUrl: up.uploadUrl })
})

/** Steg 2: klienten meddelar att filen är helt uppladdad. */
app.post('/api/uppladdning/:id/klar', requireApproved, async (c) => {
  const user = c.get('user')!
  await c.env.DB.prepare("UPDATE videos SET status = 'processing' WHERE id = ? AND user_id = ? AND status = 'uploading'")
    .bind(Number(c.req.param('id')), user.id)
    .run()
  return c.json({ ok: true })
})

app.get('/klipp/:id', requireApproved, async (c) => {
  const id = Number(c.req.param('id'))
  const video = await c.env.DB.prepare(
    `SELECT v.id, v.title, v.stream_uid, v.customer_code, v.status, v.duration_s, v.description, v.created_at, u.name AS author
     FROM videos v JOIN users u ON u.id = v.user_id WHERE v.id = ?`,
  )
    .bind(id)
    .first<{ id: number; stream_uid: string; customer_code: string | null; status: string; duration_s: number | null } & Record<string, unknown>>()
  if (!video) return c.notFound()

  // Fråga Stream om status tills videon är klar, spara resultatet (inkl. kundkod första gången)
  let customerCode: string | null = video.customer_code
  if ((video.status !== 'ready' && video.status !== 'error') || !customerCode) {
    try {
      const st = await getStatus(c.env, video.stream_uid)
      if (st?.customerCode && !customerCode) {
        customerCode = st.customerCode
        await c.env.DB.prepare('UPDATE videos SET customer_code = ? WHERE id = ?').bind(customerCode, id).run()
      }
      if (st?.ready && video.status !== 'ready') {
        video.status = 'ready'
        video.duration_s = st.durationS
        await c.env.DB.prepare("UPDATE videos SET status = 'ready', duration_s = ? WHERE id = ?").bind(st.durationS, id).run()
      } else if (st?.error) {
        video.status = 'error'
        await c.env.DB.prepare("UPDATE videos SET status = 'error' WHERE id = ?").bind(id).run()
      }
    } catch (e) {
      console.error(e)
    }
  }
  let player: string | null = null
  if (video.status === 'ready' && customerCode) {
    try {
      player = playerUrl(customerCode, await signedToken(c.env, video.stream_uid))
    } catch (e) {
      console.error(e)
    }
  }
  const { results: comments } = await c.env.DB.prepare(
    `SELECT k.id, k.body, k.timestamp_s, k.created_at, k.user_id, u.name AS author
     FROM comments k JOIN users u ON u.id = k.user_id WHERE k.video_id = ? ORDER BY k.created_at ASC`,
  )
    .bind(id)
    .all()
  return c.html(videoPage(c.get('user')!, video as any, comments as any, player))
})

app.post('/klipp/:id/kommentar', requireApproved, async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const form = await c.req.parseBody()
  const body = String(form.body ?? '').trim().slice(0, 4000)
  const ts = parseTimestamp(String(form.ts ?? ''))
  if (!body) return c.redirect(`/klipp/${id}`)
  await c.env.DB.prepare('INSERT INTO comments (video_id, user_id, timestamp_s, body) VALUES (?, ?, ?, ?)')
    .bind(id, user.id, ts, body)
    .run()
  return c.redirect(`/klipp/${id}#kommentarer`)
})

app.post('/kommentar/:id/radera', requireApproved, async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const k = await c.env.DB.prepare('SELECT video_id, user_id FROM comments WHERE id = ?')
    .bind(id)
    .first<{ video_id: number; user_id: number }>()
  if (!k) return c.notFound()
  if (k.user_id !== user.id && !user.is_admin) return c.text('Inte din kommentar', 403)
  await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run()
  return c.redirect(`/klipp/${k.video_id}`)
})

app.post('/klipp/:id/radera', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'))
  const v = await c.env.DB.prepare('SELECT stream_uid FROM videos WHERE id = ?').bind(id).first<{ stream_uid: string }>()
  if (v) await deleteVideo(c.env, v.stream_uid).catch(console.error)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM comments WHERE video_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(id),
  ])
  return c.redirect('/')
})

// ---------- Admin ----------
app.get('/admin', requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, email, name, approved, is_admin, password_hash FROM users ORDER BY approved ASC, created_at DESC',
  ).all<User>()
  const q = c.req.query()
  return c.html(
    adminPage(c.get('user')!, results, {
      added: q.added ? Number(q.added) : undefined,
      error: q.fel,
      info: q.info,
      registrationCode: registrationCode(c.env),
    }),
  )
})
app.post('/admin/bjud-in', requireAdmin, async (c) => {
  const form = await c.req.parseBody()
  const emails = String(form.emails ?? '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
  if (!emails.length) return c.redirect('/admin?fel=' + encodeURIComponent('Ingen giltig e-postadress hittades.'))
  await c.env.DB.batch(
    emails.map((e) =>
      c.env.DB.prepare(
        'INSERT INTO users (email, name, approved) VALUES (?, ?, 1) ON CONFLICT(email) DO UPDATE SET approved = 1',
      ).bind(e, e),
    ),
  )
  return c.redirect(`/admin?added=${emails.length}`)
})
app.post('/admin/:id/godkann', requireAdmin, async (c) => {
  await c.env.DB.prepare('UPDATE users SET approved = 1 WHERE id = ?').bind(Number(c.req.param('id'))).run()
  return c.redirect('/admin')
})
app.post('/admin/:id/nollstall-losenord', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'))
  if (id === c.get('user')!.id) return c.redirect('/admin')
  await c.env.DB.prepare('UPDATE users SET password_hash = NULL WHERE id = ?').bind(id).run()
  return c.redirect('/admin?info=' + encodeURIComponent('Lösenordet är nollställt. Personen skapar konto på nytt med samma adress.'))
})
app.post('/admin/:id/stang', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'))
  if (id === c.get('user')!.id) return c.redirect('/admin')
  await c.env.DB.prepare('UPDATE users SET approved = 0 WHERE id = ? AND is_admin = 0').bind(id).run()
  return c.redirect('/admin')
})

app.notFound((c) => c.text('Sidan finns inte', 404))

// ---------- Hjälpfunktioner ----------
/** "1:42" -> 102, "1:02:05" -> 3725, tomt -> null */
function parseTimestamp(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const parts = t.split(':').map((p) => Number(p))
  if (parts.some((p) => !Number.isInteger(p) || p < 0) || parts.length > 3) return null
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

export default app
