export type Totali = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

declare module 'claude-code' {
  interface PluginState {
    'barra-sessione': {
      ultimaRisposta: number | null
      totali: Totali
      adesso: number
      handoffInCorso: boolean
    }
  }
}
