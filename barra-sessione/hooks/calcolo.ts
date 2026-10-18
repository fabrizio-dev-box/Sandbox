import type { SessionRateLimit, SessionUsage } from 'claude-code'

import type { Totali } from '../types'

const MINUTO = 60_000
const ORA = 60 * MINUTO

export type StatoCache = {
  stato: 'nessuna' | 'in-uso' | 'ok' | 'poco' | 'scaduta'
  restanteMs: number
  durataMs: number
  motivo: string
}

// Un'ora con un abbonamento sotto i limiti; cinque minuti con la chiave API
// (nessuna finestra di limite letta) o con una finestra già al 100%.
export function durataCache(rateLimits: readonly SessionRateLimit[]): {
  durataMs: number
  motivo: string
} {
  if (rateLimits.length === 0) {
    return { durataMs: 5 * MINUTO, motivo: 'chiave API: 5 minuti' }
  }
  if (rateLimits.some(r => r.percentUsed >= 100)) {
    return { durataMs: 5 * MINUTO, motivo: 'oltre il limite: 5 minuti' }
  }

  return { durataMs: ORA, motivo: 'abbonamento sotto i limiti: 1 ora' }
}

export function statoCache(
  rateLimits: readonly SessionRateLimit[],
  ultimaRisposta: number | null,
  adesso: number,
  isWorking: boolean,
): StatoCache {
  const { durataMs, motivo } = durataCache(rateLimits)
  if (isWorking) {
    return { stato: 'in-uso', restanteMs: durataMs, durataMs, motivo }
  }
  if (ultimaRisposta === null) {
    return { stato: 'nessuna', restanteMs: 0, durataMs, motivo }
  }
  const restanteMs = ultimaRisposta + durataMs - adesso
  if (restanteMs <= 0) {
    return { stato: 'scaduta', restanteMs: 0, durataMs, motivo }
  }
  const soglia = Math.max(MINUTO, durataMs / 6)

  return { stato: restanteMs <= soglia ? 'poco' : 'ok', restanteMs, durataMs, motivo }
}

export function coloreCache(stato: StatoCache['stato']): 'success' | 'warning' | 'error' | 'subtle' {
  if (stato === 'ok' || stato === 'in-uso') return 'success'
  if (stato === 'poco') return 'warning'
  if (stato === 'scaduta') return 'error'

  return 'subtle'
}

export function testoCache(c: StatoCache): string {
  if (c.stato === 'in-uso') return 'in uso'
  if (c.stato === 'nessuna') return 'non ancora scritta'
  if (c.stato === 'scaduta') return 'scaduta'

  return `scade tra ${orologio(c.restanteMs)}`
}

// 125_400 → "125,4k"; 1_234_567 → "1,23M"
export function token(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return decimale(n / 1000, n < 100_000 ? 1 : 0) + 'k'

  return decimale(n / 1_000_000, 2) + 'M'
}

export function migliaia(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function dollari(usd: number): string {
  return '$' + usd.toFixed(2).replace('.', ',')
}

function decimale(n: number, cifre: number): string {
  const fisso = n.toFixed(cifre)

  return (fisso.includes('.') ? fisso.replace(/\.?0+$/, '') : fisso).replace('.', ',')
}

// mm:ss sotto l'ora, altrimenti "1h 05m"
export function orologio(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`

  return `${m}:${String(sec).padStart(2, '0')}`
}

// Tempo al rinnovo: "4g 3h", "2h 10m", "35m"
export function durata(ms: number): string {
  const min = Math.max(0, Math.round(ms / MINUTO))
  const g = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (g > 0) return `${g}g ${h}h`
  if (h > 0) return `${h}h ${m}m`

  return `${m}m`
}

export type Limite = { nome: string; percento: number; rinnovo?: string }

export function limiti(rateLimits: readonly SessionRateLimit[], adesso: number): Limite[] {
  const nomi: Record<string, string> = { five_hour: '5 ore', seven_day: 'Settimana' }
  const ordine = ['five_hour', 'seven_day']

  return [...rateLimits]
    .filter(r => r.kind in nomi)
    .sort((a, b) => ordine.indexOf(a.kind) - ordine.indexOf(b.kind))
    .map(r => {
      const reset = r.resetsAt ? Date.parse(r.resetsAt) : NaN

      return {
        nome: nomi[r.kind] ?? r.kind,
        percento: r.percentUsed,
        rinnovo: Number.isNaN(reset) ? undefined : durata(reset - adesso),
      }
    })
}

export function totaleToken(t: Totali): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite
}

export type Riepilogo = {
  cache: StatoCache
  contesto: SessionUsage['context']
  limiti: Limite[]
  totali: Totali
  usd?: number
}

export function riepilogoEsteso(r: Riepilogo): string {
  const righe: string[] = []
  righe.push('Riepilogo della sessione')
  righe.push('')
  righe.push(`Cache: ${testoCache(r.cache)} (stima: ${r.cache.motivo})`)
  if (r.contesto.tokens === undefined) {
    righe.push(`Contesto: nessuna risposta ancora, finestra di ${migliaia(r.contesto.window)} token`)
  } else {
    righe.push(
      `Contesto: ${migliaia(r.contesto.tokens)} token su ${migliaia(r.contesto.window)} (${r.contesto.percent ?? 0}%)`,
    )
  }
  if (r.limiti.length === 0) {
    righe.push('Limiti: nessuna lettura (chiave API, o ancora nessuna risposta)')
  } else {
    for (const l of r.limiti) {
      righe.push(`Limite ${l.nome}: ${l.percento}% usato${l.rinnovo ? `, si rinnova tra ${l.rinnovo}` : ''}`)
    }
  }
  righe.push(`Token della sessione: ${migliaia(totaleToken(r.totali))}`)
  righe.push(`  input non in cache: ${migliaia(r.totali.input)}`)
  righe.push(`  letti dalla cache: ${migliaia(r.totali.cacheRead)}`)
  righe.push(`  scritti in cache: ${migliaia(r.totali.cacheWrite)}`)
  righe.push(`  output: ${migliaia(r.totali.output)}`)
  righe.push(
    r.usd === undefined
      ? 'Costo a prezzi API: non disponibile'
      : `Costo a prezzi API: ${dollari(r.usd)}`,
  )

  return righe.join('\n')
}
