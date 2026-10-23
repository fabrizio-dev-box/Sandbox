import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Totali } from '../types'
import {
  coloreCache,
  dollari,
  limiti,
  riepilogoEsteso,
  statoCache,
  testoCache,
  token,
  totaleToken,
} from './calcolo'

const VUOTI: Totali = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const ultimaRisposta = atom({ plugin: 'barra-sessione', key: 'ultimaRisposta' } as const, null)
const totali = atom({ plugin: 'barra-sessione', key: 'totali' } as const, VUOTI)
const adesso = atom({ plugin: 'barra-sessione', key: 'adesso' } as const, 0)
const handoffInCorso = atom({ plugin: 'barra-sessione', key: 'handoffInCorso' } as const, false)

const PROMPT_HANDOFF = `Scrivi un riassunto di passaggio di consegne di questa sessione, in italiano, che servirà come primo messaggio di una chat nuova e vuota.
Includi: l'obiettivo, cosa è stato fatto (file toccati, decisioni prese e perché), lo stato attuale, cosa resta da fare e i passi successivi concreti, e ogni dettaglio indispensabile (percorsi, comandi, nomi, errori ancora aperti).
Scrivilo rivolto al prossimo assistente, conciso ma completo. Rispondi solo con il riassunto, senza preamboli.`

// Dove la barra è stata disegnata l'ultima volta, per la diagnosi di /token.
const disegni: Record<string, string> = {}

// Se replay-theater fornisce /replay: riletto a ogni avvio e ogni minuto.
let haReplay = false

async function cercaReplay($: EngineInterface) {
  const comandi = await $.command.list()
  haReplay = comandi.some(
    c => c.name === 'replay' && (c.plugin ?? '').startsWith('replay-theater'),
  )
}

async function azzera($: EngineInterface) {
  await update($, ultimaRisposta, () => null)
  await update($, totali, () => VUOTI)
}

async function riepilogo($: EngineInterface, isWorking: boolean) {
  const uso = await $.session.usage()
  const ora = await $.clock.now()

  return {
    cache: statoCache(uso.rateLimits, await read($, ultimaRisposta), ora, isWorking),
    contesto: uso.context,
    limiti: limiti(uso.rateLimits, ora),
    totali: await read($, totali),
    usd: uso.cost?.usd,
  }
}

async function handoff($: EngineInterface) {
  if (await read($, handoffInCorso)) return
  await update($, handoffInCorso, () => true)
  try {
    $.ui.toast('Handoff: scrivo il riassunto della sessione…')
    const risposta = await $.model.fork({ prompt: PROMPT_HANDOFF })
    if (!risposta.isAnswered) {
      $.ui.toast(`Handoff non riuscito (${risposta.reason}): la chat resta com'è`)

      return
    }
    await $.command.run({ command: 'clear' })
    await azzera($)
    const bozza = await $.prompt.fill({ text: risposta.text.trim() })
    $.ui.toast(
      bozza.isFilled
        ? 'Chat pulita: il riassunto è nella casella come bozza'
        : 'Chat pulita, ma la casella non ha preso la bozza',
    )
  } finally {
    await update($, handoffInCorso, () => false)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'token',
      description: 'Riepilogo per esteso: cache, contesto, limiti, token e costo della sessione',
    })
    await cercaReplay($)
    const ora = await $.clock.now()
    await update($, adesso, () => ora)
    let giri = 0
    $.clock.every(5000, () => {
      void $.clock.now().then(ora => update($, adesso, () => ora))
      giri += 1
      if (giri % 12 === 0) void cercaReplay($)
    })

    return next(e)
  })

  on('session.end', { reason: 'clear' }, async ($, e, next) => {
    await azzera($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const uso = e.usage
    if (uso) {
      await update($, totali, t => ({
        input: t.input + uso.input_tokens,
        output: t.output + uso.output_tokens,
        cacheRead: t.cacheRead + uso.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + uso.cache_creation_input_tokens,
      }))
    }
    if (e.agentId === undefined && uso) {
      const ora = await $.clock.now()
      await update($, ultimaRisposta, () => ora)
    }

    return next(e)
  })

  on('command.run', { command: 'token' }, async $ => {
    const superfici = await $.session.surfaces()
    const visti = Object.entries(disegni).map(([s, quando]) => `${s} alle ${quando}`)
    const diagnosi = [
      '',
      `Superfici collegate: ${superfici.length > 0 ? superfici.join(', ') : 'nessuna'}`,
      `Barra disegnata: ${visti.length > 0 ? visti.join(', ') : 'mai'}`,
    ].join('\n')

    return { text: riepilogoEsteso(await riepilogo($, false)) + '\n' + diagnosi }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view?.agentId !== undefined) {
      return next(e)
    }
    disegni[e.surface] = new Date(await $.clock.now()).toTimeString().slice(0, 8)
    await read($, adesso)
    const r = await riepilogo($, e.props.isWorking)
    const inCorso = await read($, handoffInCorso)
    const { Box, Button, Text } = $.ui.resolve(e)
    const ctx = r.contesto
    const sep = <Text dimColor> · </Text>

    return (
      <Box flexDirection="row" flexWrap="wrap">
        <Text dimColor>Cache </Text>
        <Text color={coloreCache(r.cache.stato)}>
          {testoCache(r.cache)}
        </Text>
        {sep}
        <Text dimColor>
          Contesto{' '}
          {ctx.tokens === undefined
            ? `— / ${token(ctx.window)}`
            : `${token(ctx.tokens)} / ${token(ctx.window)} (${ctx.percent ?? 0}%)`}
        </Text>
        {r.limiti.map(l => (
          <Text dimColor>
            {' · '}
            {l.nome} {l.percento}%{l.rinnovo ? ` ↻ ${l.rinnovo}` : ''}
          </Text>
        ))}
        {sep}
        <Text dimColor>
          Token {token(totaleToken(r.totali))}
          {r.usd === undefined ? '' : ` ≈ ${dollari(r.usd)}`}{' '}
        </Text>
        <Button
          key="handoff"
          label={inCorso ? 'Handoff…' : 'Handoff'}
          onPress={() => (e.props.isWorking ? $.ui.toast('Aspetta che il turno finisca') : handoff($))}
        />
        {haReplay && (
          <Button key="replay" label="Replay" onPress={() => $.command.run({ command: 'replay' })} />
        )}
      </Box>
    )
  })
}
