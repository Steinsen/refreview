import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'

export type Env = {
  DB: D1Database
  ADMIN_EMAILS: string
  APP_URL: string
  APP_NAME: string
  MAIL_FROM: string
  SESSION_SECRET: string
  RESEND_API_KEY: string
  REGISTRATION_CODE: string
  CF_ACCOUNT_ID: string
  CF_STREAM_API_TOKEN: string
  STREAM_MAX_SECONDS: string
}

export type User = {
  id: number
  email: string
  name: string
  approved: number
  is_admin: number
  pending?: number
  password_hash?: string | null
}

export type Vars = { user: User | null }
export type App = { Bindings: Env; Variables: Vars }

const SESSION_COOKIE = 'dv_session'
const SESSION_DAYS = 30
const CODE_TTL_MIN = 10
const CODE_MAX_ATTEMPTS = 5
export const MIN_PASSWORD = 8

export function isAdminEmail(env: Env, email: string) {
  return env.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())
}

export function normalizeEmail(s: string) {
  return s.trim().toLowerCase()
}

export function isValidEmail(s: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
}

/** Registreringskoden från miljön. Tom sträng = registrering bara för adresser i ADMIN_EMAILS och inbjudna. */
export function registrationCode(env: Env) {
  return (env.REGISTRATION_CODE ?? '').trim()
}

/** Läser sessionscookien och sätter c.var.user (eller null). */
export const loadUser: MiddlewareHandler<App> = async (c, next) => {
  c.set('user', null)
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    try {
      const payload = (await verify(token, c.env.SESSION_SECRET, 'HS256')) as { uid: number }
      const user = await c.env.DB.prepare('SELECT id, email, name, approved, is_admin, pending FROM users WHERE id = ?')
        .bind(payload.uid)
        .first<User>()
      if (user) {
        if (isAdminEmail(c.env, user.email) && (!user.is_admin || !user.approved)) {
          await c.env.DB.prepare('UPDATE users SET is_admin = 1, approved = 1, pending = 0 WHERE id = ?').bind(user.id).run()
          user.is_admin = 1
          user.approved = 1
          user.pending = 0
        }
        c.set('user', user)
      }
    } catch {
      deleteCookie(c, SESSION_COOKIE, { path: '/' })
    }
  }
  await next()
}

/** Kräver inloggad OCH aktiv användare. */
export const requireApproved: MiddlewareHandler<App> = async (c, next) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  if (!user.approved) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.redirect('/login?fel=avstangd')
  }
  await next()
}

export const requireAdmin: MiddlewareHandler<App> = async (c, next) => {
  const user = c.get('user')
  if (!user || !user.approved) return c.redirect('/login')
  if (!user.is_admin) return c.text('Endast admin', 403)
  await next()
}

// ---------- Session ----------

async function startSession(c: Context<App>, userId: number) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400
  const token = await sign({ uid: userId, exp }, c.env.SESSION_SECRET)
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 })
}

export function logout(c: Context<App>) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.redirect('/login?info=utloggad')
}

// ---------- Lösenord ----------

const PBKDF2_ITERATIONS = 100_000

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

/** Format: pbkdf2$<iterationer>$<salt i base64>$<hash i base64> */
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

/** Jämför utan att läcka hur många tecken som stämde. */
function equalStrings(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iterations, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iterations || !salt || !hash) return false
  const got = await derive(password, fromBase64(salt), Number(iterations))
  return equalStrings(toBase64(got), hash)
}

// ---------- Byt lösenord ----------

export type ChangePasswordResult = 'ok' | 'fel_nuvarande'

/**
 * Byter lösenord på ett inloggat konto. Saknar kontot lösenord (kom in via mejlkoden,
 * eller nollställt av admin) sätts det första utan att nuvarande lösenord krävs.
 */
export async function changePassword(
  c: Context<App>,
  userId: number,
  current: string,
  next: string,
): Promise<ChangePasswordResult> {
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(userId)
    .first<{ password_hash: string | null }>()
  if (row?.password_hash && !(await verifyPassword(current, row.password_hash))) return 'fel_nuvarande'
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(next), userId).run()
  return 'ok'
}

/** Har kontot ett lösenord satt? Styr om formuläret frågar efter det nuvarande. */
export async function hasPassword(c: Context<App>, userId: number) {
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(userId)
    .first<{ password_hash: string | null }>()
  return !!row?.password_hash
}

// ---------- Registrering ----------

export type RegisterResult = 'ok' | 'vantar' | 'finns_redan' | 'fel_kod' | 'stangd' | 'avstangd'

/**
 * Skapar ett konto med lösenord. Är en registreringskod satt måste den stämma.
 * Adresser i ADMIN_EMAILS och adresser som admin lagt till i listan släpps in direkt –
 * alla andra hamnar i kö och kommer in först när admin godkänner dem.
 */
export async function register(
  c: Context<App>,
  input: { name: string; email: string; password: string; code: string },
): Promise<RegisterResult> {
  const { name, email, password, code } = input
  const existing = await c.env.DB.prepare('SELECT id, approved, pending, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number; approved: number; pending: number; password_hash: string | null }>()
  if (existing?.password_hash) return 'finns_redan'

  const admin = isAdminEmail(c.env, email)
  const invited = !!existing && existing.approved === 1
  if (!admin && !invited) {
    // Redan nekad eller avstängd adress får inte försöka igen
    if (existing && !existing.approved && !existing.pending) return 'avstangd'
    const expected = registrationCode(c.env)
    if (expected && !equalStrings(code.trim().toLowerCase(), expected.toLowerCase())) return 'fel_kod'
  }

  // Bara admin och inbjudna adresser kommer in direkt, övriga får vänta på godkännande
  const approved = admin || invited
  const hash = await hashPassword(password)
  await c.env.DB.prepare(
    `INSERT INTO users (email, name, approved, is_admin, pending, password_hash) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash,
       approved = excluded.approved, pending = excluded.pending,
       is_admin = MAX(users.is_admin, excluded.is_admin)`,
  )
    .bind(email, name, approved ? 1 : 0, admin ? 1 : 0, approved ? 0 : 1, hash)
    .run()

  if (!approved) return 'vantar'
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: number }>()
  if (!user) return 'stangd'
  await startSession(c, user.id)
  return 'ok'
}

// ---------- Inloggning med lösenord ----------

export type LoginResult = 'ok' | 'fel' | 'inget_losenord' | 'vantar' | 'avstangd'

export async function loginWithPassword(c: Context<App>, email: string, password: string): Promise<LoginResult> {
  const user = await c.env.DB.prepare('SELECT id, approved, pending, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number; approved: number; pending: number; password_hash: string | null }>()
  if (!user) return 'fel'
  if (!user.password_hash) return 'inget_losenord'
  if (!(await verifyPassword(password, user.password_hash))) return 'fel'
  if (!user.approved && !isAdminEmail(c.env, email)) return user.pending ? 'vantar' : 'avstangd'
  await startSession(c, user.id)
  return 'ok'
}

// ---------- Engångskod på mejl (alternativ väg in) ----------

async function hashCode(env: Env, email: string, code: string) {
  const data = new TextEncoder().encode(`${email}:${code}:${env.SESSION_SECRET}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function randomCode() {
  const n = new Uint32Array(1)
  crypto.getRandomValues(n)
  return String(n[0] % 1_000_000).padStart(6, '0')
}

export type RequestCodeResult = 'sent' | 'not_allowed' | 'send_failed'

/**
 * Skapar en kod för adressen och skickar den. Bara adresser som admin lagt till (och som är aktiva) får kod.
 * Adminadresser från konfig skapas automatiskt vid första försöket.
 */
export async function requestCode(env: Env, email: string): Promise<RequestCodeResult> {
  if (isAdminEmail(env, email)) {
    await env.DB.prepare(
      'INSERT INTO users (email, name, approved, is_admin) VALUES (?, ?, 1, 1) ON CONFLICT(email) DO UPDATE SET approved = 1, is_admin = 1',
    )
      .bind(email, email)
      .run()
  }
  const user = await env.DB.prepare('SELECT id, approved FROM users WHERE email = ?').bind(email).first<{ id: number; approved: number }>()
  if (!user || !user.approved) return 'not_allowed'

  const code = randomCode()
  const hash = await hashCode(env, email, code)
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_codes WHERE email = ? OR expires_at < datetime('now')").bind(email),
    env.DB.prepare(`INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, datetime('now', '+${CODE_TTL_MIN} minutes'))`).bind(
      email,
      hash,
    ),
  ])

  const ok = await sendMail(env, {
    to: email,
    subject: `${code} är din inloggningskod till ${env.APP_NAME}`,
    text: `Din inloggningskod till ${env.APP_NAME} är:\n\n${code}\n\nKoden gäller i ${CODE_TTL_MIN} minuter. Har du inte försökt logga in kan du ignorera det här mejlet.`,
  })
  return ok ? 'sent' : 'send_failed'
}

export type VerifyResult = 'ok' | 'wrong' | 'expired' | 'locked'

export async function verifyCode(c: Context<App>, email: string, code: string): Promise<VerifyResult> {
  const row = await c.env.DB.prepare(
    "SELECT id, code_hash, attempts, expires_at < datetime('now') AS expired FROM login_codes WHERE email = ?",
  )
    .bind(email)
    .first<{ id: number; code_hash: string; attempts: number; expired: number }>()
  if (!row || row.expired) return 'expired'
  if (row.attempts >= CODE_MAX_ATTEMPTS) return 'locked'

  const hash = await hashCode(c.env, email, code.replace(/\D/g, ''))
  if (hash !== row.code_hash) {
    await c.env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run()
    return row.attempts + 1 >= CODE_MAX_ATTEMPTS ? 'locked' : 'wrong'
  }

  await c.env.DB.prepare('DELETE FROM login_codes WHERE id = ?').bind(row.id).run()
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND approved = 1').bind(email).first<{ id: number }>()
  if (!user) return 'expired'

  await startSession(c, user.id)
  return 'ok'
}

// ---------- E-post via Resend ----------

async function sendMail(env: Env, msg: { to: string; subject: string; text: string }) {
  if (!env.RESEND_API_KEY) {
    // Lokal utveckling utan e-posttjänst: koden syns i terminalen
    console.log(`[mail till ${msg.to}] ${msg.subject}\n${msg.text}`)
    return true
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text }),
  })
  if (!res.ok) console.error('Resend', res.status, await res.text())
  return res.ok
}
