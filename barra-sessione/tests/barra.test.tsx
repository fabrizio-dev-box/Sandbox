import { expect, mock, test } from 'claude-code/testing'

const ORA = 1_800_000_000_000

const BAND = {
  plugin: 'barra-sessione',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 9, contentRows: 1 },
    view: {},
  },
} as const

test('la barra mostra cache, contesto, limiti, costo e Replay', async ($, on) => {
  const clock = mock.clock(on, { now: ORA })
  on('command.register', () => ({ value: {} }) as never)
  on('ui.render', () => null as never)
  on('session.usage', () => ({ value: {
    startedAt: ORA,
    context: { tokens: 48_200, window: 200_000, percent: 24 },
    rateLimits: [
      { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(ORA + 3 * 86_400_000).toISOString() },
      { kind: 'five_hour', percentUsed: 31, resetsAt: new Date(ORA + 2 * 3_600_000).toISOString() },
    ],
    cost: { usd: 3.456 },
  } }))
  on('command.list', () => ({ value: [
    { name: 'replay', description: 'Replay', source: 'plugin', plugin: 'replay-theater@x' },
  ] }))
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start({ cwd: '/' } as never)
  await $.turn.complete({
    answer: 'ok',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { model: 'm', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2000 },
  } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: 'scade tra 1h 00m' })).toBeDefined()
    expect(await ui.find({ text: /Contesto 48,2k \/ 200k \(24%\)/ })).toBeDefined()
    expect(await ui.find({ text: /5 ore 31% ↻ 2h 0m/ })).toBeDefined()
    expect(await ui.find({ text: /Settimana 12% ↻ 3g 0h/ })).toBeDefined()
    expect(await ui.find({ text: /Token 43,5k ≈ \$3,46/ })).toBeDefined()
    expect(await ui.find({ key: 'handoff' })).toBeDefined()
    expect(await ui.find({ key: 'replay' })).toBeDefined()
    await ui.unmount()
  }

  await clock.advance(52 * 60_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /^scade tra 8:0\d$/ })).toBeDefined()
  await ui.unmount()

  const { text } = await $.command.run({ command: 'token' } as never)
  expect(text).toContain('Limite 5 ore: 31% usato')
  expect(text).toContain('Costo a prezzi API: $3,46')
})

test('Handoff riassume, pulisce la chat e mette la bozza nella casella', async ($, on) => {
  mock.clock(on, { now: ORA })
  const fatti: string[] = []
  on('command.register', () => ({ value: {} }) as never)
  on('ui.render', () => null as never)
  on('ui.toast', () => ({ value: {} }) as never)
  on('session.start', () => ({ cwd: '/' }))
  on('command.list', () => ({ value: [] }))
  on('session.usage', () => ({
    value: { startedAt: ORA, context: { window: 200_000 }, rateLimits: [] },
  }))
  on('model.fork', () => {
    fatti.push('fork')

    return { value: { isAnswered: true, text: '  Riassunto della sessione  ', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('command.run', { command: 'clear' }, () => {
    fatti.push('clear')

    return { text: '' }
  })
  on('prompt.fill', (_$, e) => {
    fatti.push(`fill:${e.text}`)

    return { isFilled: true }
  })

  await $.session.start({ cwd: '/' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: 'non ancora scritta' })).toBeDefined()
  expect(await ui.find({ key: 'replay' })).toBeUndefined()
  await ui.press({ key: 'handoff' })
  expect(fatti).toEqual(['fork', 'clear', 'fill:Riassunto della sessione'])
  await ui.unmount()
})
