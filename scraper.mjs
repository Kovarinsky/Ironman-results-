#!/usr/bin/env node
/**
 * ironman-scraper.mjs
 *
 * Stahuje výsledky závodů Ironman pro české závodníky.
 * Podporuje plné závody Ironman (226 km) i Ironman 70.3 (113 km).
 *
 * Použití:
 *   node scripts/ironman-scraper.mjs [možnosti]
 *
 * Možnosti:
 *   --from <rok>     Stahuje od roku (default: 2015)
 *   --to <rok>       Stahuje do roku (default: aktuální rok)
 *   --year <rok>     Pouze jeden konkrétní rok
 *   --full-only      Pouze plné Ironman závody (226 km)
 *   --703-only       Pouze Ironman 70.3 závody (113 km)
 *   --output <cesta> Výstupní složka (default: ./data/ironman)
 *   --visible        Zobrazit prohlížeč (pro ladění, default: headless)
 *   --dry-run        Vypíše plán bez stahování
 *   --help           Zobrazí nápovědu
 *
 * Výstup (složka data/ironman/):
 *   czech-athletes.json     – všechny výsledky, strukturovaně
 *   czech-athletes.csv      – CSV pro import do Excelu
 *   races-{rok}.json        – výsledky per rok
 */

import { chromium } from 'playwright'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── CLI argumenty ────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(`
Ironman výsledky scraper – zaměřeno na české závodníky (CZE)

Použití:
  node scripts/ironman-scraper.mjs [--from 2015] [--to 2024] [--year 2023]
                                   [--full-only | --703-only] [--output ./data]
                                   [--visible] [--dry-run]

Výstup: data/ironman/
  czech-athletes.json   strukturovaná data
  czech-athletes.csv    pro Excel / Google Sheets
  races-{rok}.json      detaily po závodních letech
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
  outputDir: getArg('--output', join(__dirname, 'data')),
  headless: !args.includes('--visible'),
  dryRun: args.includes('--dry-run'),
  delayMs: 1500,
  maxRetries: 3,
  chromiumPath: '/opt/pw-browsers/chromium/chrome',
}

// ─── Pomocné funkce ───────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function saveJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
  log(`Uloženo: ${path}`)
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

// ─── Databáze závodů ─────────────────────────────────────────────────────────
//
// Ironman mění URL strukturu, takže udržujeme lokální seznam závodů.
// Klíče: id (interní), name, type, countryISO, urlSlug (Ironman web slug).
// Doplňte nové závody do pole KNOWN_RACES.

const KNOWN_RACES = [
  // Česká republika
  { id: 'im-cz', name: 'Ironman Czech Republic', type: 'FULL', countryISO: 'CZE', urlSlug: 'im-czech-republic' },
  { id: 'im703-cz', name: 'Ironman 70.3 Czech Republic', type: '703', countryISO: 'CZE', urlSlug: 'im703-czech-republic' },
  // Sousední/oblíbené závody u Čechů
  { id: 'im-austria', name: 'Ironman Austria', type: 'FULL', countryISO: 'AUT', urlSlug: 'im-austria' },
  { id: 'im703-austria', name: 'Ironman 70.3 Austria', type: '703', countryISO: 'AUT', urlSlug: 'im703-austria' },
  { id: 'im-frankfurt', name: 'Ironman Frankfurt', type: 'FULL', countryISO: 'DEU', urlSlug: 'im-frankfurt' },
  { id: 'im703-elsinore', name: 'Ironman 70.3 Elsinore', type: '703', countryISO: 'DNK', urlSlug: 'im703-elsinore' },
  { id: 'im703-zell', name: 'Ironman 70.3 Zell am See', type: '703', countryISO: 'AUT', urlSlug: 'im703-zell-am-see' },
  { id: 'im-klagenfurt', name: 'Ironman Klagenfurt', type: 'FULL', countryISO: 'AUT', urlSlug: 'im-klagenfurt' },
  { id: 'im-barcelona', name: 'Ironman Barcelona', type: 'FULL', countryISO: 'ESP', urlSlug: 'im-barcelona' },
  { id: 'im-hawaii', name: 'Ironman World Championship Hawaii', type: 'FULL', countryISO: 'USA', urlSlug: 'im-world-championship' },
  { id: 'im-nice', name: 'Ironman World Championship Nice', type: 'FULL', countryISO: 'FRA', urlSlug: 'im-world-championship-nice' },
  { id: 'im703-worlds', name: 'Ironman 70.3 World Championship', type: '703', countryISO: null, urlSlug: 'im703-world-championship' },
  { id: 'im-copenhagen', name: 'Ironman Copenhagen', type: 'FULL', countryISO: 'DNK', urlSlug: 'im-copenhagen' },
  { id: 'im-hamburg', name: 'Ironman Hamburg', type: 'FULL', countryISO: 'DEU', urlSlug: 'im-hamburg' },
  { id: 'im703-hamburg', name: 'Ironman 70.3 Hamburg', type: '703', countryISO: 'DEU', urlSlug: 'im703-hamburg' },
  { id: 'im703-duisburg', name: 'Ironman 70.3 Duisburg', type: '703', countryISO: 'DEU', urlSlug: 'im703-duisburg' },
  { id: 'im703-stpoelten', name: 'Ironman 70.3 St. Pölten', type: '703', countryISO: 'AUT', urlSlug: 'im703-st-poelten' },
  { id: 'im703-gdynia', name: 'Ironman 70.3 Gdynia', type: '703', countryISO: 'POL', urlSlug: 'im703-gdynia' },
]

// ─── Ironman Results API ──────────────────────────────────────────────────────
//
// Ironman využívá backend označovaný jako "race results" (dříve Sportstats,
// nyní vlastní platforma Ironman).  Endpointy se mění – pokud skript selže,
// zkontrolujte aktuální API v DevTools > Network při návštěvě:
//   https://www.ironman.com/races/{slug}/results
//
// Aktuální (2024-2025) struktura API:
//   GET /api/race-results
//     ?eventId={eventId}
//     &yearId={rok}
//     &country={ISO}
//     &page={číslo}&perPage=100
//     &sort=overallRank&order=asc

async function fetchResultsViaApi(page, eventSlug, year, country) {
  // Nejprve zjistíme eventId z stránky závodu
  const eventUrl = `https://www.ironman.com/races/${eventSlug}/${year}/results`
  log(`  → API: ${eventUrl}`)

  const interceptedData = []

  await page.route('**/api/race-results**', async (route) => {
    const response = await route.fetch()
    try {
      const json = await response.json()
      interceptedData.push(json)
    } catch {}
    await route.fulfill({ response })
  })

  await page.goto(eventUrl, { waitUntil: 'networkidle', timeout: 30000 })
  await sleep(cfg.delayMs)

  // Hledáme filtr podle země a stránkujeme
  return interceptedData.flatMap((d) => d?.data ?? d?.results ?? [])
}

// ─── DOM scraping (záloha) ────────────────────────────────────────────────────

async function scrapeResultsDom(page, eventSlug, year) {
  const url = `https://www.ironman.com/races/${eventSlug}/${year}/results?per_page=100&country_iso=${cfg.country}`
  log(`  → DOM: ${url}`)

  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
  await sleep(cfg.delayMs)

  const results = []
  let pageNum = 1
  let hasMore = true

  while (hasMore) {
    const rows = await page.$$eval(
      'table tbody tr, [class*="result-row"], [class*="ResultRow"]',
      (els) =>
        els.map((el) => {
          const cells = el.querySelectorAll('td, [class*="cell"], [class*="Col"]')
          return Array.from(cells).map((c) => c.innerText.trim())
        })
    )

    const rowObjects = rows
      .filter((cells) => cells.length >= 6)
      .map((cells) => parseResultRow(cells))
      .filter((r) => r !== null)

    results.push(...rowObjects)

    // Přejdeme na další stránku, pokud existuje
    const nextBtn = await page.$('[aria-label="Next page"], .pagination-next:not(.disabled), button[data-page="next"]')
    if (nextBtn && pageNum < 50) {
      await nextBtn.click()
      await sleep(cfg.delayMs)
      pageNum++
    } else {
      hasMore = false
    }
  }

  return results
}

function parseResultRow(cells) {
  // Pořadí sloupců se liší závod od závodu, ale typicky:
  // [rank, name, country, ageGroup, swim, t1, bike, t2, run, finish, points]
  if (cells.length < 5) return null

  // Heuristika: hledáme českou vlajku nebo "CZE" v buňkách
  const hasCze = cells.some((c) => /CZE|Czech/i.test(c))
  if (!hasCze) return null

  return {
    overallRank: parseInt(cells[0]) || null,
    athleteName: cells.find((c) => /[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]/.test(c)) ?? cells[1],
    country: 'CZE',
    ageGroup: cells.find((c) => /[MF]\d{2}-\d{2}|MPRO|FPRO/.test(c)) ?? '',
    swimTime: cells.find((c) => /^\d{1,2}:\d{2}:\d{2}$/.test(c) && cells.indexOf(c) < cells.length - 3) ?? '',
    t1Time: '',
    bikeTime: '',
    t2Time: '',
    runTime: '',
    finishTime: cells.find((c) => /^\d{1,2}:\d{2}:\d{2}$/.test(c)) ?? cells[cells.length - 2],
    divisionRank: null,
    gender: '',
    status: 'Finisher',
  }
}

// ─── Strategický scraper s fallbackem ────────────────────────────────────────

async function fetchCzechAthletes(page, race, year) {
  log(`\nZávod: ${race.name} (${year})`)

  const results = []

  try {
    // Strategie 1: zachycení API požadavku (nejspolehlivější)
    const apiResults = await fetchResultsViaApi(page, race.urlSlug, year, cfg.country)

    if (apiResults.length > 0) {
      const czech = apiResults.filter(
        (r) => r?.country === 'CZE' || r?.countryIso === 'CZE' || r?.nationality === 'CZE'
      )
      log(`  ✓ API: ${czech.length} českých závodníků`)
      return czech.map((r) => normalizeApiResult(r, race, year))
    }
  } catch (err) {
    log(`  ! API selhala: ${err.message} – zkusím DOM scraping`)
  }

  try {
    // Strategie 2: DOM scraping
    const domResults = await scrapeResultsDom(page, race.urlSlug, year)
    log(`  ✓ DOM: ${domResults.length} výsledků`)
    return domResults.map((r) => ({ ...r, raceName: race.name, raceType: race.type, year }))
  } catch (err) {
    log(`  ! DOM scraping selhalo: ${err.message}`)
    return []
  }
}

function normalizeApiResult(raw, race, year) {
  return {
    year,
    raceName: race.name,
    raceType: race.type,
    athleteName: raw.athleteName ?? raw.fullName ?? raw.name ?? '',
    athleteId: raw.athleteId ?? raw.id ?? null,
    country: 'CZE',
    gender: raw.gender ?? raw.sex ?? '',
    ageGroup: raw.ageGroup ?? raw.division ?? '',
    overallRank: raw.overallRank ?? raw.rank ?? null,
    divisionRank: raw.divisionRank ?? raw.ageGroupRank ?? null,
    swimTime: raw.swimTime ?? raw.swim ?? '',
    t1Time: raw.t1Time ?? raw.t1 ?? '',
    bikeTime: raw.bikeTime ?? raw.bike ?? raw.cycleTime ?? '',
    t2Time: raw.t2Time ?? raw.t2 ?? '',
    runTime: raw.runTime ?? raw.run ?? '',
    finishTime: raw.finishTime ?? raw.totalTime ?? raw.totalDuration ?? '',
    status: raw.status ?? raw.finishStatus ?? 'Finisher',
    points: raw.points ?? raw.qualPoints ?? null,
  }
}

// ─── Alternativa: přímý web scraper závodníka podle jména/nationaliaty ────────
//
// Ironman nabízí vyhledávání závodníků na:
//   https://www.ironman.com/search-results?q=&filter=athletes&country=CZE
// Každý závodník má profil s historií výsledků.

async function discoverCzechAthletes(page) {
  log('\nHledám české závodníky přes vyhledávač Ironman...')

  const url = 'https://www.ironman.com/search-results?q=&filter=athletes&country=CZE&per_page=100'
  const athletes = []

  const intercepted = []
  await page.route('**/api/**', async (route) => {
    const resp = await route.fetch()
    try { intercepted.push(await resp.json()) } catch {}
    await route.fulfill({ response: resp })
  })

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  await sleep(cfg.delayMs)

  // Sbíráme závodníky z výsledků
  const items = await page.$$eval(
    '[class*="athlete"], [class*="result-item"], .search-result',
    (els) => els.map((el) => ({
      name: el.querySelector('[class*="name"], h3, h4')?.innerText?.trim() ?? '',
      id: el.getAttribute('data-athlete-id') ?? el.querySelector('a')?.href ?? '',
      country: el.querySelector('[class*="country"]')?.innerText?.trim() ?? 'CZE',
    }))
  )

  athletes.push(...items.filter((a) => a.name))

  // Z API interceptu
  for (const data of intercepted) {
    const list = data?.athletes ?? data?.data ?? data?.results ?? []
    athletes.push(...list.filter((a) => a?.country === 'CZE' || a?.nationality === 'CZE'))
  }

  log(`  Nalezeno ${athletes.length} českých závodníků`)
  return [...new Map(athletes.map((a) => [a.id || a.name, a])).values()]
}

// ─── Hlavní orchestrace ───────────────────────────────────────────────────────

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗')
  console.log('║     Ironman Scraper – čeští závodníci (CZE)       ║')
  console.log('╚═══════════════════════════════════════════════════╝')
  console.log(`Roky: ${cfg.fromYear}–${cfg.toYear}`)
  console.log(`Typy: ${cfg.raceTypes.join(', ')}`)
  console.log(`Výstup: ${cfg.outputDir}`)

  ensureDir(cfg.outputDir)

  if (cfg.dryRun) {
    const races = KNOWN_RACES.filter((r) => cfg.raceTypes.includes(r.type))
    const years = Array.from({ length: cfg.toYear - cfg.fromYear + 1 }, (_, i) => cfg.fromYear + i)
    console.log(`\n[DRY RUN] Plánováno ${races.length * years.length} kombinací závod×rok:`)
    for (const year of years) {
      for (const race of races) {
        console.log(`  ${year} – ${race.name} (${race.type})`)
      }
    }
    return
  }

  // Detekujeme dostupný Chromium
  let executablePath
  for (const candidate of [
    '/opt/pw-browsers/chromium/chrome',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium-headless-shell/headless-shell',
  ]) {
    try {
      const { statSync } = await import('fs')
      statSync(candidate)
      executablePath = candidate
      break
    } catch {}
  }

  const browser = await chromium.launch({
    headless: cfg.headless,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (compatible; IronmanCzechScraper/1.0; research use)',
    locale: 'cs-CZ',
    viewport: { width: 1280, height: 900 },
  })

  const page = await context.newPage()

  const allResults = []
  const byYear = {}

  const races = KNOWN_RACES.filter((r) => cfg.raceTypes.includes(r.type))
  const years = Array.from({ length: cfg.toYear - cfg.fromYear + 1 }, (_, i) => cfg.fromYear + i)

  log(`\nCelkem závodů ke zpracování: ${races.length} × ${years.length} let`)

  for (const year of years) {
    const yearResults = []

    for (const race of races) {
      let retries = cfg.maxRetries
      while (retries-- > 0) {
        try {
          const results = await fetchCzechAthletes(page, race, year)
          yearResults.push(...results)
          allResults.push(...results)
          break
        } catch (err) {
          if (retries === 0) {
            log(`  ✗ Závod ${race.name} ${year} přeskočen po ${cfg.maxRetries} pokusech: ${err.message}`)
          } else {
            log(`  ↻ Retry (${cfg.maxRetries - retries}/${cfg.maxRetries})...`)
            await sleep(cfg.delayMs * 2)
          }
        }
      }

      await sleep(cfg.delayMs)
    }

    if (yearResults.length > 0) {
      byYear[year] = yearResults
      saveJson(join(cfg.outputDir, `races-${year}.json`), {
        year,
        generated: new Date().toISOString(),
        country: cfg.country,
        total: yearResults.length,
        results: yearResults,
      })
    }
  }

  // Celkový výstup
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

  await browser.close()

  console.log('\n═══════════════════════════════════════════════════')
  console.log(`✓ Hotovo. Celkem ${allResults.length} výsledků českých závodníků.`)
  if (allResults.length === 0) {
    console.log('\nℹ️  Žádné výsledky – možné příčiny:')
    console.log('   1. Ironman změnil strukturu webu/API (viz komentáře v kódu)')
    console.log('   2. Závody v zadaném rozsahu let ještě neproběhly')
    console.log('   3. Zkuste --visible pro ladění v prohlížeči')
  }
  console.log('═══════════════════════════════════════════════════\n')
}

main().catch((err) => {
  console.error('Kritická chyba:', err)
  process.exit(1)
})
