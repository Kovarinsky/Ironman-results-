#!/usr/bin/env node
/**
 * scraper.mjs – Ironman výsledky pro české závodníky (CZE)
 * Strategie: přímé HTTP fetch (bez Playwright/prohlížeče)
 *
 * Použití:
 *   node scraper.mjs [--from 2015] [--to 2026] [--year 2024]
 *                    [--full-only | --703-only] [--output ./data] [--dry-run]
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── CLI argumenty ─────────────────────────────────────────────────────────

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(`
Ironman výsledky scraper – čeští závodníci (CZE)

Použití:
  node scraper.mjs [--from 2015] [--to 2026] [--year 2024]
                   [--full-only | --703-only] [--output ./data] [--dry-run]
`)
  process.exit(0)
}

function getArg(flag, fallback) {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const currentYear = new Date().getFullYear()

const cfg = {
  country: 'CZE',
  fromYear: args.includes('--year')
    ? parseInt(getArg('--year', currentYear))
    : parseInt(getArg('--from', '2015')),
  toYear: args.includes('--year')
    ? parseInt(getArg('--year', currentYear))
    : parseInt(getArg('--to', String(currentYear))),
  raceTypes: args.includes('--full-only')
    ? ['FULL']
    : args.includes('--703-only')
    ? ['703']
    : ['FULL', '703'],
  outputDir: getArg('--output', join(process.cwd(), 'data')),
  dryRun: args.includes('--dry-run'),
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

const BASE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
}

async function httpGet(url, { asJson = false, timeout = 20000, referer } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)

  const headers = {
    ...BASE_HEADERS,
    Accept: asJson
      ? 'application/json, */*;q=0.8'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
  if (referer) headers['Referer'] = referer
  if (asJson) {
    headers['Sec-Fetch-Dest'] = 'empty'
    headers['Sec-Fetch-Mode'] = 'cors'
    headers['Sec-Fetch-Site'] = 'same-origin'
    headers['X-Requested-With'] = 'XMLHttpRequest'
  }

  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return asJson ? res.json() : res.text()
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') throw new Error(`Timeout (${timeout}ms)`)
    throw err
  }
}

// ─── Databáze závodů ────────────────────────────────────────────────────────

const KNOWN_RACES = [
  { id: 'im-cz', name: 'Ironman Czech Republic', type: 'FULL', urlSlug: 'im-czech-republic' },
  { id: 'im703-cz', name: 'Ironman 70.3 Czech Republic', type: '703', urlSlug: 'im703-czech-republic' },
  { id: 'im-austria', name: 'Ironman Austria', type: 'FULL', urlSlug: 'im-austria' },
  { id: 'im703-austria', name: 'Ironman 70.3 Austria', type: '703', urlSlug: 'im703-austria' },
  { id: 'im-frankfurt', name: 'Ironman Frankfurt', type: 'FULL', urlSlug: 'im-frankfurt' },
  { id: 'im703-elsinore', name: 'Ironman 70.3 Elsinore', type: '703', urlSlug: 'im703-elsinore' },
  { id: 'im703-zell', name: 'Ironman 70.3 Zell am See', type: '703', urlSlug: 'im703-zell-am-see' },
  { id: 'im-klagenfurt', name: 'Ironman Klagenfurt', type: 'FULL', urlSlug: 'im-klagenfurt' },
  { id: 'im-barcelona', name: 'Ironman Barcelona', type: 'FULL', urlSlug: 'im-barcelona' },
  { id: 'im-hawaii', name: 'Ironman World Championship Hawaii', type: 'FULL', urlSlug: 'im-world-championship' },
  { id: 'im-nice', name: 'Ironman World Championship Nice', type: 'FULL', urlSlug: 'im-world-championship-nice' },
  { id: 'im703-worlds', name: 'Ironman 70.3 World Championship', type: '703', urlSlug: 'im703-world-championship' },
  { id: 'im-copenhagen', name: 'Ironman Copenhagen', type: 'FULL', urlSlug: 'im-copenhagen' },
  { id: 'im-hamburg', name: 'Ironman Hamburg', type: 'FULL', urlSlug: 'im-hamburg' },
  { id: 'im703-hamburg', name: 'Ironman 70.3 Hamburg', type: '703', urlSlug: 'im703-hamburg' },
  { id: 'im703-duisburg', name: 'Ironman 70.3 Duisburg', type: '703', urlSlug: 'im703-duisburg' },
  { id: 'im703-stpoelten', name: 'Ironman 70.3 St. Pölten', type: '703', urlSlug: 'im703-st-poelten' },
  { id: 'im703-gdynia', name: 'Ironman 70.3 Gdynia', type: '703', urlSlug: 'im703-gdynia' },
]

// ─── Scraping výsledků ──────────────────────────────────────────────────────

async function fetchCzechAthletes(race, year) {
  log(`\nZávod: ${race.name} (${year})`)

  const pageBase = `https://www.ironman.com/races/${race.urlSlug}/${year}/results`

  // Strategie 1: JSON API (různé URL vzory – ironman.com mění endpointy)
  const apiCandidates = [
    `https://www.ironman.com/umbraco/api/race-results/getresults?slug=${race.urlSlug}&year=${year}&country=CZE&page=1&pageSize=500`,
    `https://www.ironman.com/umbraco/api/raceresults/getresults?slug=${race.urlSlug}&year=${year}&country=CZE&page=1&pageSize=500`,
    `https://www.ironman.com/api/race-results?eventSlug=${race.urlSlug}&year=${year}&country=CZE&page=1&perPage=500`,
    `https://www.ironman.com/api/results?slug=${race.urlSlug}&year=${year}&country=CZE`,
    `${pageBase}.json?country=CZE`,
    `${pageBase}?format=json&country=CZE`,
  ]

  for (const apiUrl of apiCandidates) {
    try {
      log(`  → API: ${apiUrl.replace('https://www.ironman.com', '')}`)
      const data = await httpGet(apiUrl, { asJson: true, timeout: 15000, referer: pageBase })
      const results = extractResultsList(data)
      if (results.length > 0) {
        const czech = filterCzech(results)
        log(`  ✓ API: ${czech.length} CZE závodníků (z ${results.length} celkem)`)
        return czech.map((r) => normalizeResult(r, race, year))
      }
    } catch (err) {
      log(`  ! API: ${err.message}`)
    }
  }

  // Strategie 2: HTML stránka → embedded JSON data
  try {
    log(`  → HTML: ${pageBase}`)
    const html = await httpGet(pageBase, { timeout: 20000 })
    const results = extractFromHtml(html)
    if (results.length > 0) {
      const czech = filterCzech(results)
      log(`  ✓ HTML: ${czech.length} CZE závodníků`)
      return czech.map((r) => normalizeResult(r, race, year))
    }
    const sizekb = Math.round(html.length / 1024)
    log(`  ! HTML bez výsledků (${sizekb} kB, pravděpodobně blok nebo prázdná stránka)`)
  } catch (err) {
    log(`  ! HTML: ${err.message}`)
  }

  return []
}

function extractResultsList(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  for (const key of ['results', 'athletes', 'data', 'items', 'content', 'entries', 'finishers', 'participants']) {
    if (Array.isArray(data[key]) && data[key].length > 0) return data[key]
  }
  return []
}

function filterCzech(list) {
  return list.filter(
    (r) =>
      r?.country === 'CZE' ||
      r?.countryIso === 'CZE' ||
      r?.nationality === 'CZE' ||
      r?.countryCode === 'CZE' ||
      r?.BIBCountry === 'CZE' ||
      r?.CountryISO === 'CZE'
  )
}

function extractFromHtml(html) {
  // Next.js __NEXT_DATA__
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s)
  if (nextMatch) {
    try {
      return deepFindResults(JSON.parse(nextMatch[1]))
    } catch {}
  }

  // window.__DATA__ / __INITIAL_STATE__ apod.
  for (const [, json] of html.matchAll(
    /window\.(?:__DATA__|__INITIAL_STATE__|__RESULTS__|initialData|raceData)\s*=\s*({.+?});/gs
  )) {
    try {
      const found = deepFindResults(JSON.parse(json))
      if (found.length > 0) return found
    } catch {}
  }

  // <script type="application/json">
  for (const [, json] of html.matchAll(/<script[^>]*type="application\/json"[^>]*>(.+?)<\/script>/gs)) {
    try {
      const found = deepFindResults(JSON.parse(json))
      if (found.length > 0) return found
    } catch {}
  }

  return []
}

function deepFindResults(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return []

  if (Array.isArray(obj)) {
    if (
      obj.length > 0 &&
      obj[0] &&
      typeof obj[0] === 'object' &&
      (obj[0].athleteName || obj[0].fullName || obj[0].name || obj[0].finishTime || obj[0].overallRank || obj[0].bib)
    ) {
      return obj
    }
    for (const item of obj) {
      const f = deepFindResults(item, depth + 1)
      if (f.length > 0) return f
    }
    return []
  }

  for (const key of ['results', 'athletes', 'data', 'items', 'content', 'entries', 'finishers', 'participants']) {
    if (Array.isArray(obj[key]) && obj[key].length > 0) return obj[key]
  }

  for (const val of Object.values(obj)) {
    const f = deepFindResults(val, depth + 1)
    if (f.length > 0) return f
  }

  return []
}

function normalizeResult(raw, race, year) {
  return {
    year,
    raceName: race.name,
    raceType: race.type,
    athleteName:
      raw.athleteName ??
      raw.fullName ??
      raw.name ??
      `${raw.firstName ?? ''} ${raw.lastName ?? ''}`.trim(),
    athleteId: raw.athleteId ?? raw.id ?? null,
    country: 'CZE',
    gender: raw.gender ?? raw.sex ?? '',
    ageGroup: raw.ageGroup ?? raw.division ?? raw.category ?? '',
    overallRank: raw.overallRank ?? raw.rank ?? raw.position ?? null,
    divisionRank: raw.divisionRank ?? raw.ageGroupRank ?? raw.categoryRank ?? null,
    swimTime: raw.swimTime ?? raw.swim ?? '',
    t1Time: raw.t1Time ?? raw.t1 ?? '',
    bikeTime: raw.bikeTime ?? raw.bike ?? raw.cycleTime ?? '',
    t2Time: raw.t2Time ?? raw.t2 ?? '',
    runTime: raw.runTime ?? raw.run ?? '',
    finishTime: raw.finishTime ?? raw.totalTime ?? raw.totalDuration ?? raw.time ?? '',
    status: raw.status ?? raw.finishStatus ?? raw.finishType ?? 'Finisher',
    points: raw.points ?? raw.qualPoints ?? null,
  }
}

// ─── Výstupní helpers ───────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function saveJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  log(`Uloženo: ${filePath}`)
}

function toCsv(results) {
  const header = [
    'Rok', 'Závod', 'Typ', 'Jméno', 'Pohlaví', 'Věková kategorie',
    'Celkové pořadí', 'Kategorijní pořadí', 'Plavání', 'T1', 'Kolo', 'T2',
    'Běh', 'Celkový čas', 'Status',
  ].join(';')

  const rows = results.map((r) =>
    [
      r.year, escapeCsv(r.raceName), r.raceType,
      escapeCsv(r.athleteName), r.gender, r.ageGroup,
      r.overallRank, r.divisionRank,
      r.swimTime, r.t1Time, r.bikeTime, r.t2Time, r.runTime,
      r.finishTime, r.status,
    ].join(';')
  )

  return [header, ...rows].join('\n')
}

function escapeCsv(val) {
  if (val == null) return ''
  const s = String(val)
  return s.includes(';') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗')
  console.log('║     Ironman Scraper – čeští závodníci (CZE)       ║')
  console.log('╚═══════════════════════════════════════════════════╝')
  console.log(`Roky: ${cfg.fromYear}–${cfg.toYear}`)
  console.log(`Typy: ${cfg.raceTypes.join(', ')}`)
  console.log(`Výstup: ${cfg.outputDir}`)
  console.log(`Strategie: přímé HTTP (bez prohlížeče)`)

  ensureDir(cfg.outputDir)

  const races = KNOWN_RACES.filter((r) => cfg.raceTypes.includes(r.type))
  const years = Array.from({ length: cfg.toYear - cfg.fromYear + 1 }, (_, i) => cfg.fromYear + i)

  if (cfg.dryRun) {
    console.log(`\n[DRY RUN] ${races.length} závodů × ${years.length} let:`)
    for (const year of years) {
      for (const race of races) {
        console.log(`  ${year} – ${race.name} (${race.type})`)
      }
    }
    return
  }

  log(`\nCelkem závodů ke zpracování: ${races.length} × ${years.length} let`)

  const allResults = []

  for (const year of years) {
    const yearResults = []

    for (const race of races) {
      try {
        const results = await fetchCzechAthletes(race, year)
        yearResults.push(...results)
        allResults.push(...results)
      } catch (err) {
        log(`  ✗ ${race.name} ${year}: ${err.message}`)
      }
      await sleep(500)
    }

    if (yearResults.length > 0) {
      saveJson(join(cfg.outputDir, `races-${year}.json`), {
        year,
        generated: new Date().toISOString(),
        country: cfg.country,
        total: yearResults.length,
        results: yearResults,
      })
    }
  }

  if (allResults.length > 0) {
    saveJson(join(cfg.outputDir, 'czech-athletes.json'), {
      generated: new Date().toISOString(),
      fromYear: cfg.fromYear,
      toYear: cfg.toYear,
      country: cfg.country,
      total: allResults.length,
      results: allResults,
    })
    writeFileSync(join(cfg.outputDir, 'czech-athletes.csv'), toCsv(allResults), 'utf-8')
    log(`Uloženo CSV: ${join(cfg.outputDir, 'czech-athletes.csv')}`)
  }

  console.log('\n═══════════════════════════════════════════════════')
  console.log(`✓ Hotovo. Celkem ${allResults.length} výsledků českých závodníků.`)
  if (allResults.length === 0) {
    console.log('\nℹ️  Žádné výsledky – ironman.com blokuje GitHub Actions IP.')
    console.log('   Spusťte lokálně: npm run scrape:letos')
  }
  console.log('═══════════════════════════════════════════════════\n')
}

main().catch((err) => {
  console.error('Kritická chyba:', err)
  process.exit(1)
})
