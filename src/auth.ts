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
  CF_ACCOUNT_ID: string
  CF_STREAM_API_TOKEN: string
  STREAM_CUSTOMER_CODE: string
  STREAM_MAX_SECONDS: string
}

export type User = {
  id: number
  email: string
  name: string
  approved: number
  is_admin: number
}

export type Vars = { user: User | null }
export type App = { Bindings: Env; Variables: Vars }

const SESSION_COOKIE = 'dv_session'
const SESSION_DAYS = 30
const CODE_TTL_MIN = 10
const CODE_MAX_ATTEMPTS = 5

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

/** Läser sessionscookien och sätter c.var.user (eller null). */
export const loadUser: MiddlewareHandler<App> = async (c, next) => {
  c.set('user', null)
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    try {
      const payload = (await verify(token, c.env.SESSION_SECRET, 'HS256')) as { uid: number }
      const user = await c.env.DB.prepare('SELECT id, email, name, approved, is_admin FROM users WHERE id = ?')
        .bind(payload.uid)
        .first<User>()
      if (user) {
        if (isAdminEmail(c.env, user.email) && (!user.is_admin || !user.approved)) {
          await c.env.DB.prepare('UPDATE users SET is_admin = 1, approved = 1 WHERE id = ?').bind(user.id).run()
          user.is_admin = 1
          user.approved = 1
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

// ---------- Engångskod ----------

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

  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400
  const token = await sign({ uid: user.id, exp }, c.env.SESSION_SECRET)
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 })
  return 'ok'
}

export function logout(c: Context<App>) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.redirect('/login')
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
