import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { createStaticApi } from './static-api'

export const cn = (...inputs) => twMerge(clsx(inputs))

export const fmt = (n) => {
  n = Number(n) || 0
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}

export const fmtDuration = (ms) => {
  const m = Math.round((Number(ms) || 0) / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

// HTML exportado: os dados vêm embutidos na página e a API roda em memória.
export const STATIC_DATA = typeof window !== 'undefined' ? window.__TOKENMETRO_DATA__ ?? null : null
const staticApi = STATIC_DATA && createStaticApi(STATIC_DATA)

export async function api(path, params = {}) {
  if (staticApi) return staticApi(path, params)
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
  const res = await fetch(`/api/${path}${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error((await res.json()).error)
  return res.json()
}

export const COLORS = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#dc2626']
