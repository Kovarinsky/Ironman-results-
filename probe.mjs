#!/usr/bin/env node
/**
 * probe.mjs – Zjišťuje fungující URL pro ironman.com výsledky
 * Spusťte: node probe.mjs
 * Výstup: vypíše které URL patterns fungují (2xx/3xx) a které ne
 */

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
}

async function probe(url, label) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const r = await fetch(url, { headers: BASE_HEADERS, signal: ctrl.signal, redirect: 'manual' })
    clearTimeout(timer)
    const loc = r.headers.get('location') || ''
    const ok = r.status < 400 ? '✓' : '✗'
    console.log(`${ok} [${r.status}] ${label}`)
    if (loc) console.log(`    → redirect: ${loc}`)
    if (r.status === 200) {
      const text = await r.text()
      // Look for key markers in the HTML
      const hasNextData = text.includes('__NEXT_DATA__')
      const hasWtcEventId = text.includes('wtc_eventid')
      const hasResults = text.includes('results') && text.length > 5000
      const hasCze = text.includes('CZE') || text.includes('Czech')
      const snip = text.substring(0, 200).replace(/\n/g, ' ')
      console.log(`    __NEXT_DATA__:${hasNextData} wtc_eventid:${hasWtcEventId} results:${hasResults} CZE:${hasCze}`)
      console.log(`    preview: ${snip}`)
      // Extract wtc_eventid if present
      const uuidMatch = text.match(/"wtc_eventid"\s*:\s*"([^"]+)"/g)
      if (uuidMatch) {
        console.log(`    wtc_eventids: ${uuidMatch.slice(0, 3).join(', ')}`)
      }
    }
    return r.status
  } catch (e) {
    clearTimeout(timer)
    console.log(`✗ [ERR] ${label} → ${e.message}`)
    return 0
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('Ironman URL probe – testuje různé URL vzory')
  console.log('═══════════════════════════════════════════════════\n')

  // Test 1: ironman.com – různé URL vzory pro Frankfurt
  console.log('── ironman.com URL vzory (Frankfurt) ──')
  await probe('https://www.ironman.com/', 'ironman.com homepage')
  await probe('https://www.ironman.com/races/im-frankfurt', 'ironman.com /races/im-frankfurt')
  await probe('https://www.ironman.com/races/im-frankfurt/results', 'ironman.com /races/im-frankfurt/results')
  await probe('https://www.ironman.com/races/im-frankfurt/2025/results', 'ironman.com /races/im-frankfurt/2025/results [OLD]')
  await probe('https://www.ironman.com/races/ironman-european-championship-frankfurt', 'ironman.com /races/ironman-european-championship-frankfurt')
  await probe('https://www.ironman.com/races/ironman-frankfurt', 'ironman.com /races/ironman-frankfurt')
  await probe('https://www.ironman.com/races/mainova-ironman-frankfurt', 'ironman.com /races/mainova-ironman-frankfurt')

  console.log('\n── labs-v2.competitor.com ──')
  await probe('https://labs-v2.competitor.com/', 'labs-v2 homepage')
  await probe('https://labs-v2.competitor.com/results/event/ironman-frankfurt', 'labs-v2 /results/event/ironman-frankfurt')
  await probe('https://labs-v2.competitor.com/results/event/im-frankfurt', 'labs-v2 /results/event/im-frankfurt')
  await probe('https://labs-v2.competitor.com/results/event/ironman-european-championship-frankfurt', 'labs-v2 /results/event/ironman-european-championship-frankfurt')
  await probe('https://labs-v2.competitor.com/api/results?wtc_eventid=test', 'labs-v2 /api/results (dummy id)')

  console.log('\n── sportstats.one ──')
  await probe('https://sportstats.one/', 'sportstats.one homepage')
  await probe('https://sportstats.one/event/ironman-frankfurt', 'sportstats.one /event/ironman-frankfurt')
  await probe('https://sportstats.one/event/ironman-european-championship-frankfurt', 'sportstats.one /event/ironman-european-championship-frankfurt')
  await probe('https://sportstats.one/event/ironman-world-championship', 'sportstats.one /event/ironman-world-championship')

  console.log('\n── ironman.com – různé závody (2025) ──')
  await probe('https://www.ironman.com/races/im-klagenfurt', 'ironman.com /races/im-klagenfurt')
  await probe('https://www.ironman.com/races/im-klagenfurt/results', 'ironman.com /races/im-klagenfurt/results')
  await probe('https://www.ironman.com/races/im703-czech-republic', 'ironman.com /races/im703-czech-republic')
  await probe('https://www.ironman.com/races/im703-hradec-kralove', 'ironman.com /races/im703-hradec-kralove')
  await probe('https://www.ironman.com/races/ironman-703-hradec-kralove', 'ironman.com /races/ironman-703-hradec-kralove')
  await probe('https://www.ironman.com/races/im703-stpoelten', 'ironman.com /races/im703-stpoelten')
  await probe('https://www.ironman.com/races/im703-st-poelten', 'ironman.com /races/im703-st-poelten [OLD]')

  console.log('\n── ironman.com – search/list endpoints ──')
  await probe('https://www.ironman.com/api/races?year=2025', 'ironman.com /api/races?year=2025')
  await probe('https://www.ironman.com/umbraco/api/races/getall', 'ironman.com umbraco /api/races/getall')

  console.log('\n═══════════════════════════════════════════════════')
  console.log('Probe hotovo.')
}

main().catch(console.error)
