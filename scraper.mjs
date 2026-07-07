#!/usr/bin/env node
/**
 * scraper.mjs – Ironman výsledky pro české závodníky (CZE)
 *
 * Architektura:
 *  1. ironman.com/races/{slug}/results → UUID ze src iframe
 *  2. labs-v2.competitor.com/results/event/{UUID} → subevents (roky)
 *  3. labs-v2.competitor.com/api/results?wtc_eventid={uuid} → výsledky
 *
 * Záloha: pokud subevents jsou prázdné, zkusíme year-specific URL
 *   ironman.com/races/{slug}/{year}/results → UUID pro ten ročník
 *
 * Použití:
 *   node scraper.mjs [--from 2020] [--to 2026] [--year 2024]
 *                    [--full-only | --703-only] [--output ./data] [--dry-run]
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(`
Ironman výsledky scraper – čeští závodníci (CZE)

Použití:
  node scraper.mjs [--from 2020] [--to 2026] [--year 2024]
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
    : parseInt(getArg('--from', '2020')),
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

// ─── HTTP ─────────────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
}

async function httpGet(url, { asJson = false, timeout = 25000, referer, allowNotFound = false } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)

  const headers = {
    ...BROWSER_HEADERS,
    Accept: asJson
      ? 'application/json, */*;q=0.8'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
  if (referer) headers['Referer'] = referer
  if (asJson) {
    headers['Sec-Fetch-Dest'] = 'empty'
    headers['Sec-Fetch-Mode'] = 'cors'
    headers['Sec-Fetch-Site'] = 'same-origin'
  }

  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) {
      if (allowNotFound && res.status === 404) return null
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    return asJson ? res.json() : res.text()
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') throw new Error(`Timeout (${timeout}ms)`)
    throw err
  }
}

// ─── Závody ───────────────────────────────────────────────────────────────────

const KNOWN_RACES = [
  { id: 'im-frankfurt',       name: 'Ironman Frankfurt',                  type: 'FULL', slug: 'im-frankfurt' },
  { id: 'im703-hradec',       name: 'Ironman 70.3 Hradec Králové',        type: '703',  slug: 'im703-hradec-kralove' },
  // im703-st-poelten returns 403 from GitHub IPs; altSlug page loads but has no labs-v2 UUID embed
  { id: 'im703-stpoelten',    name: 'Ironman 70.3 St. Pölten',            type: '703',  slug: 'im703-st-poelten',       altSlugs: ['im703-st-polten'] },
  { id: 'im-lanzarote',       name: 'Ironman Lanzarote',                  type: 'FULL', slug: 'im-lanzarote' },
  { id: 'im-austria',         name: 'Ironman Austria (Klagenfurt)',       type: 'FULL', slug: 'im-austria' },
  { id: 'im-barcelona',       name: 'Ironman Barcelona',                  type: 'FULL', slug: 'im-barcelona' },
  { id: 'im-copenhagen',      name: 'Ironman Copenhagen',                 type: 'FULL', slug: 'im-copenhagen' },
  { id: 'im-hamburg',         name: 'Ironman Hamburg',                    type: 'FULL', slug: 'im-hamburg' },
  { id: 'im703-duisburg',     name: 'Ironman 70.3 Duisburg',              type: '703',  slug: 'im703-duisburg' },
  { id: 'im703-gdynia',       name: 'Ironman 70.3 Gdynia',                type: '703',  slug: 'im703-gdynia' },
  { id: 'im-hawaii',          name: 'Ironman World Championship',         type: 'FULL', slug: 'im-world-championship',  altSlugs: ['im-world-championship-kona'] },
  // 70.3 WC has no dedicated series page; the WC is co-hosted with these regular races
  { id: 'im703-sunshine-coast', name: 'Ironman 70.3 Sunshine Coast',     type: '703',  slug: 'im703-sunshine-coast' },
  { id: 'im703-new-zealand',    name: 'Ironman 70.3 New Zealand',         type: '703',  slug: 'im703-new-zealand' },
  { id: 'im703-zell',         name: 'Ironman 70.3 Zell am See',           type: '703',  slug: 'im703-zell-am-see' },
  { id: 'im703-elsinore',     name: 'Ironman 70.3 Elsinore',              type: '703',  slug: 'im703-elsinore' },
]

// ─── UUID discovery ───────────────────────────────────────────────────────────

const UUID_RE = /labs-v2\.competitor\.com\/results\/event\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

async function extractUuidFromPage(url) {
  const html = await httpGet(url, { timeout: 7000, allowNotFound: true })
  if (!html) return null
  const m = html.match(UUID_RE)
  return m ? m[1] : null
}

// Fetch the series UUID from the base results page
async function fetchSeriesUuid(slug) {
  const url = `https://www.ironman.com/races/${slug}/results`
  try {
    const uuid = await extractUuidFromPage(url)
    if (uuid) log(`  ✓ UUID série [${slug}]: ${uuid}`)
    else log(`  ✗ UUID nenalezeno na ${url}`)
    return uuid
  } catch (err) {
    log(`  ! fetchSeriesUuid(${slug}): ${err.message}`)
    return null
  }
}

// Try year-specific ironman.com results page for a per-year UUID
async function fetchYearUuid(slug, year) {
  const url = `https://www.ironman.com/races/${slug}/${year}/results`
  try {
    return await extractUuidFromPage(url)
  } catch {
    return null
  }
}

// Get subevents array from labs-v2 SSR for a UUID-based URL
async function fetchSubevents(seriesUuid) {
  const url = `https://labs-v2.competitor.com/results/event/${seriesUuid}`
  try {
    const html = await httpGet(url, { timeout: 20000 })
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/)
    if (!m) return []
    const nd = JSON.parse(m[1])
    const subevents = nd?.props?.pageProps?.subevents
    return Array.isArray(subevents) ? subevents : []
  } catch (err) {
    log(`  ! fetchSubevents(${seriesUuid}): ${err.message}`)
    return []
  }
}

// ─── API výsledků ─────────────────────────────────────────────────────────────

let _fieldsLogged = false

async function fetchResultsByEventId(wtcEventId) {
  // Try different parameter formats the API might accept
  const url = `https://labs-v2.competitor.com/api/results?wtc_eventid=${wtcEventId}`
  const data = await httpGet(url, {
    asJson: true,
    timeout: 30000,
    referer: `https://labs-v2.competitor.com/results/event/${wtcEventId}`,
  })

  const list = extractResultsList(data)

  if (!_fieldsLogged && list.length > 0) {
    _fieldsLogged = true
    const keys = Object.keys(list[0])
    log(`  [discovery] Pole (${keys.length}): ${keys.join(', ')}`)
    log(`  [discovery] Ukázka: ${JSON.stringify(list[0]).substring(0, 500)}`)
  }

  return list
}

function extractResultsList(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  // OData / common API wrappers
  for (const key of ['value', 'results', 'resultsJson', 'athletes', 'data', 'items', 'entries', 'finishers']) {
    if (Array.isArray(data[key]) && data[key].length > 0) return data[key]
    if (data[key] && typeof data[key] === 'object' && !Array.isArray(data[key])) {
      const nested = extractResultsList(data[key])
      if (nested.length > 0) return nested
    }
  }
  return []
}

// ─── Filtrace a normalizace ───────────────────────────────────────────────────

function filterCzech(list) {
  return list.filter(r => {
    if (!r || typeof r !== 'object') return false
    const directFields = [
      r.countryIso3, r.CountryIso3, r.countryiso3,
      r.countryIso, r.CountryIso, r.countryiso,
      r.country, r.Country,
      r.nationality, r.Nationality,
      r.countryCode, r.CountryCode,
      r.wtc_countryiso3, r.wtc_nationality, r.wtc_country,
      r.BIBCountry, r.CountryISO,
    ]
    if (directFields.some(v => v === 'CZE' || v === 'CZ')) return true

    // Dynamics 365 OData lookup — formatted country display name
    const fmt = r['_wtc_countryrepresentingid_value_formatted']
    if (fmt && /czech/i.test(fmt)) return true

    return false
  })
}

function getField(r, ...keys) {
  for (const k of keys) {
    if (r[k] != null && r[k] !== '') return r[k]
  }
  return ''
}

function extractYear(obj) {
  if (!obj) return null
  for (const v of Object.values(obj)) {
    if (typeof v === 'number' && v >= 2000 && v <= 2040) return v
    if (typeof v === 'string') {
      const m = v.match(/\b(20[12]\d)\b/)
      if (m) return parseInt(m[1])
    }
  }
  return null
}

function normalizeResult(raw, race, year) {
  const firstName = getField(raw, 'wtc_firstname', 'firstName', 'first_name', 'givenName')
  const lastName  = getField(raw, 'wtc_lastname',  'lastName',  'last_name',  'familyName')
  const fullParts = [firstName, lastName].filter(Boolean).join(' ')

  return {
    year,
    raceName:     race.name,
    raceType:     race.type,
    athleteName:  getField(raw, 'athleteName', 'fullName', 'name', 'wtc_name') || fullParts,
    athleteId:    getField(raw, 'athleteId', 'id', 'wtc_athleteid', 'wtc_resultid'),
    country:      'CZE',
    gender:       getField(raw, 'gender', 'sex', 'wtc_gender', 'wtc_sex'),
    ageGroup:     getField(raw, 'ageGroup', 'division', 'category', 'wtc_divisionname', 'wtc_agegroupname'),
    overallRank:  getField(raw, 'wtc_finishrank', 'wtc_finishrankoverall', 'overallRank', 'rank', 'position', 'wtc_overallrank'),
    divisionRank: getField(raw, 'wtc_finishrankgroup', 'wtc_bikerankgroup', 'divisionRank', 'ageGroupRank', 'wtc_divisionrank'),
    swimTime:     getField(raw, 'wtc_swimtimeformatted', 'swimTime', 'swim', 'wtc_swimtime', 'swim_time'),
    t1Time:       getField(raw, 'wtc_transition1timeformatted', 't1Time', 't1', 'wtc_t1time', 't1_time'),
    bikeTime:     getField(raw, 'wtc_biketimeformatted', 'bikeTime', 'bike', 'cycleTime', 'wtc_biketime', 'bike_time'),
    t2Time:       getField(raw, 'wtc_transitiontime2formatted', 't2Time', 't2', 'wtc_t2time', 't2_time'),
    runTime:      getField(raw, 'wtc_runtimeformatted', 'runTime', 'run', 'wtc_runtime', 'run_time'),
    finishTime:   getField(raw, 'wtc_finishtimeformatted', 'wtc_finishtime_formatted', 'finishTime', 'totalTime', 'wtc_finishtime', 'wtc_overalltime'),
    status:       getField(raw, 'wtc_finisher_formatted', 'status', 'finishStatus', 'finishType', 'wtc_resulttype') || 'Finisher',
    points:       getField(raw, 'points', 'qualPoints', 'wtc_points'),
  }
}

// ─── Hlavní scraping ──────────────────────────────────────────────────────────

async function fetchCzechAthletesForRace(race, fromYear, toYear, seenSeriesUuids = new Set()) {
  log(`\n── ${race.name} (${race.type}) ──`)

  // Step 1: try primary slug then altSlugs until a series UUID is found
  const slugsToTry = [race.slug, ...(race.altSlugs ?? [])]
  let seriesUuid = null
  let resolvedSlug = race.slug
  for (const slug of slugsToTry) {
    seriesUuid = await fetchSeriesUuid(slug)
    if (seriesUuid) { resolvedSlug = slug; break }
    if (slug !== slugsToTry[slugsToTry.length - 1]) await sleep(500)
  }
  if (!seriesUuid) return []

  if (seenSeriesUuids.has(seriesUuid)) {
    log(`  ↷ UUID série ${seriesUuid} již zpracován, přeskakuji`)
    return []
  }
  seenSeriesUuids.add(seriesUuid)

  // Step 2: try labs-v2 subevents via UUID-based page
  log(`  → labs-v2 subevents pro UUID ${seriesUuid}`)
  const subevents = await fetchSubevents(seriesUuid)

  if (subevents.length > 0) {
    log(`  ✓ labs-v2 vrátil ${subevents.length} ročníků`)
    log(`  [sub0] ${JSON.stringify(subevents[0]).substring(0, 300)}`)
    return await processSubevents(subevents, race, fromYear, toYear)
  }

  log(`  ℹ labs-v2 subevents prázdné (client-side rendered) – záloha přes year-specific URL`)

  // Step 3: fallback – try year-specific ironman.com pages and series UUID directly
  const resolvedRace = resolvedSlug !== race.slug ? { ...race, slug: resolvedSlug } : race
  return await processYearByYear(resolvedRace, seriesUuid, fromYear, toYear)
}

async function processSubevents(subevents, race, fromYear, toYear) {
  const results = []
  for (const sub of subevents) {
    const subYear = sub.year ?? sub.eventYear ?? sub.wtc_year ?? extractYear(sub)
    if (subYear != null && (subYear < fromYear || subYear > toYear)) continue

    const subId = sub.wtc_eventid ?? sub.eventId ?? sub.id ?? sub.uuid
    if (!subId) continue

    log(`  → API: ${subYear ?? '?'} UUID=${subId}`)
    try {
      const all = await fetchResultsByEventId(subId)
      let yr = subYear
      if (yr == null) {
        yr = extractYearFromResults(all)
        if (yr == null || yr < fromYear || yr > toYear) {
          log(`  ↷ rok ${yr ?? '?'} mimo rozsah, přeskakuji`)
          await sleep(400)
          continue
        }
      }
      const czech = filterCzech(all)
      log(`  ✓ ${czech.length} CZE / ${all.length} závodníků (${yr})`)
      results.push(...czech.map(r => normalizeResult(r, race, yr)))
    } catch (err) {
      log(`  ! API(${subId}): ${err.message}`)
    }
    await sleep(400)
  }
  return results
}

async function processYearByYear(race, seriesUuid, fromYear, toYear) {
  const results = []
  const seenUuids = new Set()

  // Try series UUID once for the current/latest race
  try {
    log(`  → API s UUID série: ${seriesUuid}`)
    const all = await fetchResultsByEventId(seriesUuid)
    if (all.length > 0) {
      const czech = filterCzech(all)
      // Detect year from the data itself
      const yr = extractYearFromResults(all) ?? toYear
      log(`  ✓ ${czech.length} CZE / ${all.length} závodníků (rok ~${yr})`)
      if (yr >= fromYear && yr <= toYear) {
        results.push(...czech.map(r => normalizeResult(r, race, yr)))
      }
      seenUuids.add(seriesUuid)
    }
  } catch (err) {
    log(`  ! API série: ${err.message}`)
  }

  await sleep(400)

  // Try year-specific ironman.com pages for each year in range
  for (let yr = toYear; yr >= fromYear; yr--) {
    const yearUuid = await fetchYearUuid(race.slug, yr)
    if (!yearUuid || seenUuids.has(yearUuid)) {
      if (yearUuid) log(`    rok ${yr}: UUID shodné se sérií, přeskakuji`)
      continue
    }
    seenUuids.add(yearUuid)
    log(`  → API: ${yr} UUID=${yearUuid}`)
    try {
      const all = await fetchResultsByEventId(yearUuid)
      const czech = filterCzech(all)
      log(`  ✓ ${czech.length} CZE / ${all.length} závodníků (${yr})`)
      results.push(...czech.map(r => normalizeResult(r, race, yr)))
    } catch (err) {
      log(`  ! API(${yearUuid}): ${err.message}`)
    }
    await sleep(400)
  }

  return results
}

function extractYearFromResults(results) {
  for (const r of results.slice(0, 5)) {
    if (!r || typeof r !== 'object') continue
    for (const v of Object.values(r)) {
      if (typeof v === 'string') {
        const m = v.match(/\b(20[12]\d)\b/)
        if (m) return parseInt(m[1])
      }
      if (typeof v === 'number' && v >= 2000 && v <= 2040) return v
    }
  }
  return null
}

// ─── Výstup ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))

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
    'Celkové pořadí', 'Kategorijní pořadí',
    'Plavání', 'T1', 'Kolo', 'T2', 'Běh', 'Celkový čas', 'Status',
  ].join(';')
  const rows = results.map(r => [
    r.year, escapeCsv(r.raceName), r.raceType,
    escapeCsv(r.athleteName), r.gender, r.ageGroup,
    r.overallRank, r.divisionRank,
    r.swimTime, r.t1Time, r.bikeTime, r.t2Time, r.runTime,
    r.finishTime, r.status,
  ].join(';'))
  return [header, ...rows].join('\n')
}

function escapeCsv(val) {
  if (val == null) return ''
  const s = String(val)
  return s.includes(';') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
}

// ─── Top 10 výpis ────────────────────────────────────────────────────────────

function parseTimeToSeconds(t) {
  if (!t || typeof t !== 'string') return Infinity
  const parts = t.trim().split(':').map(Number)
  if (parts.some(isNaN)) return Infinity
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Infinity
}

function printTop10(results) {
  if (results.length === 0) return

  const years = [...new Set(results.map(r => r.year))].sort()
  const yearLabel = years.length === 1 ? `${years[0]}` : `${years[0]}–${years[years.length - 1]}`

  console.log('\n╔══════════════════════════════════════════════════════════════════╗')
  console.log(`║   TOP 10 českých závodníků  –  ${yearLabel.padEnd(34)}║`)
  console.log('╚══════════════════════════════════════════════════════════════════╝')

  for (const type of ['FULL', '703']) {
    const label = type === 'FULL' ? 'Ironman (plná vzdálenost)' : 'Ironman 70.3'
    const subset = results
      .filter(r => r.raceType === type)
      .filter(r => r.status && !/dns|dnf|dsq/i.test(r.status))
      .sort((a, b) => parseTimeToSeconds(a.finishTime) - parseTimeToSeconds(b.finishTime))

    if (subset.length === 0) continue

    console.log(`\n  ── ${label} ─────────────────────────────────────────────────`)
    console.log(`  ${'#'.padEnd(3)} ${'Jméno'.padEnd(28)} ${'Závod'.padEnd(24)} ${'Rok'.padEnd(5)} ${'Čas'.padEnd(10)} ${'Pořadí'.padEnd(7)} ${'Kat.'}`)
    console.log(`  ${'─'.repeat(3)} ${'─'.repeat(28)} ${'─'.repeat(24)} ${'─'.repeat(5)} ${'─'.repeat(10)} ${'─'.repeat(7)} ${'─'.repeat(12)}`)

    const top = subset.slice(0, 10)
    top.forEach((r, i) => {
      const rank = String(i + 1).padEnd(3)
      const name = (r.athleteName || '?').substring(0, 27).padEnd(28)
      const race = r.raceName.replace(/^Ironman\s*/i, '').substring(0, 23).padEnd(24)
      const yr   = String(r.year).padEnd(5)
      const time = (r.finishTime || '?').padEnd(10)
      const pos  = String(r.overallRank || '?').padEnd(7)
      const cat  = r.ageGroup || ''
      console.log(`  ${rank} ${name} ${race} ${yr} ${time} ${pos} ${cat}`)
    })
    console.log(`\n  Celkem finišerů z ČR: ${subset.length}`)
  }

  console.log('\n══════════════════════════════════════════════════════════════════\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗')
  console.log('║     Ironman Scraper – čeští závodníci (CZE)       ║')
  console.log('╚═══════════════════════════════════════════════════╝')
  console.log(`Roky: ${cfg.fromYear}–${cfg.toYear}`)
  console.log(`Typy: ${cfg.raceTypes.join(', ')}`)
  console.log(`Výstup: ${cfg.outputDir}`)

  ensureDir(cfg.outputDir)

  const races = KNOWN_RACES.filter(r => cfg.raceTypes.includes(r.type))

  if (cfg.dryRun) {
    console.log(`\n[DRY RUN] ${races.length} závodů:`)
    races.forEach(r => console.log(`  ${r.name} (${r.type}) → /races/${r.slug}/results`))
    return
  }

  log(`\nCelkem závodů: ${races.length}`)

  const allResults = []
  const seenSeriesUuids = new Set()

  for (const race of races) {
    try {
      const results = await fetchCzechAthletesForRace(race, cfg.fromYear, cfg.toYear, seenSeriesUuids)
      allResults.push(...results)
    } catch (err) {
      log(`✗ ${race.name}: ${err.message}`)
    }
    await sleep(600)
  }

  printTop10(allResults)

  // Per-year JSON files
  const byYear = {}
  for (const r of allResults) {
    byYear[r.year] = byYear[r.year] ?? []
    byYear[r.year].push(r)
  }
  for (const [year, yearResults] of Object.entries(byYear)) {
    saveJson(join(cfg.outputDir, `races-${year}.json`), {
      year: parseInt(year),
      generated: new Date().toISOString(),
      country: cfg.country,
      total: yearResults.length,
      results: yearResults,
    })
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
    console.log('\nℹ  Žádné výsledky. Viz logy výše pro detaily UUID discovery a API volání.')
  }
  console.log('═══════════════════════════════════════════════════\n')
}

main().catch(err => {
  console.error('Kritická chyba:', err)
  process.exit(1)
})
