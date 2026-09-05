import type { Env } from './auth'

const api = (env: Env, path: string) => `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream${path}`
const headers = (env: Env) => ({ Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}` })

function b64(s: string) {
  return btoa(unescape(encodeURIComponent(s)))
}

/**
 * Skapar en återupptagbar (tus) direktuppladdning hos Stream.
 * Klienten laddar sedan upp filen direkt till den URL som returneras – filen passerar aldrig vår worker.
 */
export async function createTusUpload(env: Env, opts: { sizeBytes: number; name: string; creator: string }) {
  const meta = [
    `name ${b64(opts.name)}`,
    `maxDurationSeconds ${b64(env.STREAM_MAX_SECONDS || '1800')}`,
    'requiresignedurls',
  ].join(',')
  const res = await fetch(api(env, '?direct_user=true'), {
    method: 'POST',
    headers: {
      ...headers(env),
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(opts.sizeBytes),
      'Upload-Metadata': meta,
      'Upload-Creator': opts.creator.slice(0, 64),
    },
  })
  if (res.status !== 201) throw new Error(`Stream svarade ${res.status}: ${await res.text()}`)
  const uploadUrl = res.headers.get('Location')
  const uid = res.headers.get('stream-media-id')
  if (!uploadUrl || !uid) throw new Error('Stream returnerade ingen upload-URL')
  return { uploadUrl, uid }
}

export type StreamStatus = { ready: boolean; error: boolean; durationS: number | null; state: string }

export async function getStatus(env: Env, uid: string): Promise<StreamStatus | null> {
  const res = await fetch(api(env, `/${uid}`), { headers: headers(env) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Stream svarade ${res.status}`)
  const data = (await res.json()) as {
    result: { readyToStream: boolean; duration: number; status: { state: string } }
  }
  const r = data.result
  return {
    ready: r.readyToStream,
    error: r.status.state === 'error',
    durationS: r.duration > 0 ? Math.round(r.duration) : null,
    state: r.status.state,
  }
}

/** Kortlivad signerad token så att bara inloggade kan spela klippet. */
export async function signedToken(env: Env, uid: string, ttlSeconds = 3600) {
  const res = await fetch(api(env, `/${uid}/token`), {
    method: 'POST',
    headers: { ...headers(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttlSeconds, downloadable: false }),
  })
  if (!res.ok) throw new Error(`Kunde inte signera video (${res.status})`)
  const data = (await res.json()) as { result: { token: string } }
  return data.result.token
}

export async function deleteVideo(env: Env, uid: string) {
  const res = await fetch(api(env, `/${uid}`), { method: 'DELETE', headers: headers(env) })
  if (!res.ok && res.status !== 404) throw new Error(`Kunde inte radera video (${res.status})`)
}

export function playerUrl(env: Env, token: string) {
  return `https://customer-${env.STREAM_CUSTOMER_CODE}.cloudflarestream.com/${token}/iframe`
}
