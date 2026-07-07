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
      const hasNextData = text.includes('__NEXT_DATA__')
      const hasResults = text.includes('results') && text.length > 5000
      const hasCze = text.includes('CZE') || text.includes('Czech')
      console.log(`    __NEXT_DATA__:${hasNextData} results:${hasResults} CZE:${hasCze} len:${text.length}`)

      if (hasNextData) {
        const m = text.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/)
        if (m) {
          try {
            const nd = JSON.parse(m[1])
            console.log(`    ND top keys: ${Object.keys(nd).join(', ')}`)
            console.log(`    buildId:${nd.buildId} page:${nd.page} query:${JSON.stringify(nd.query)}`)
            const pp = nd.props?.pageProps
            if (pp) {
              console.log(`    pageProps keys: ${Object.keys(pp).join(', ')}`)
              for (const k of Object.keys(pp).slice(0, 15)) {
                const v = pp[k]
                if (Array.isArray(v)) {
                  console.log(`      .${k}: Array(${v.length})${v[0] ? ' [0]keys:' + Object.keys(v[0]).join(',') : ''}`)
                } else if (v && typeof v === 'object') {
                  console.log(`      .${k}: {${Object.keys(v).join(',')}}`)
                } else {
                  console.log(`      .${k}: ${JSON.stringify(v)?.substring(0, 80)}`)
                }
              }
            }
            // Find all UUIDs in the entire __NEXT_DATA__ JSON
            const allText = JSON.stringify(nd)
            const uuids = [...new Set((allText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []))]
            if (uuids.length) console.log(`    UUIDs in ND: ${uuids.slice(0, 5).join(', ')}`)
            else console.log(`    No UUIDs in __NEXT_DATA__`)
          } catch (e) {
            console.log(`    ND parse error: ${e.message}`)
            console.log(`    ND raw (200 chars): ${m[1].substring(0, 200)}`)
          }
        }
      }

      // Find all UUIDs anywhere in page source (with context for first one)
      const pageUuids = [...new Set((text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []))]
      if (pageUuids.length) {
        console.log(`    Page UUIDs: ${pageUuids.slice(0, 5).join(', ')}`)
        // Show context around first UUID
        const firstUuid = pageUuids[0]
        const idx = text.indexOf(firstUuid)
        if (idx >= 0) {
          const ctx = text.substring(Math.max(0, idx - 60), idx + firstUuid.length + 60).replace(/\n/g, ' ')
          console.log(`    UUID ctx: ...${ctx}...`)
        }
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

  console.log('\n── labs-v2 – další závody ──')
  await probe('https://labs-v2.competitor.com/results/event/ironman-703-czech-republic', 'labs-v2 /results/event/ironman-703-czech-republic')
  await probe('https://labs-v2.competitor.com/results/event/ironman-703-hradec-kralove', 'labs-v2 /results/event/ironman-703-hradec-kralove')
  await probe('https://labs-v2.competitor.com/results/event/ironman-703-st-polten', 'labs-v2 /results/event/ironman-703-st-polten')
  await probe('https://labs-v2.competitor.com/results/event/ironman-703-st-poelten', 'labs-v2 /results/event/ironman-703-st-poelten')
  await probe('https://labs-v2.competitor.com/results/event/ironman-klagenfurt', 'labs-v2 /results/event/ironman-klagenfurt')
  await probe('https://labs-v2.competitor.com/results/event/ironman-703-klagenfurt', 'labs-v2 /results/event/ironman-703-klagenfurt')
  await probe('https://labs-v2.competitor.com/results/event/ironman-703-austria', 'labs-v2 /results/event/ironman-703-austria')
  await probe('https://labs-v2.competitor.com/results/event/ironman-703-wels', 'labs-v2 /results/event/ironman-703-wels')

  console.log('\n── labs-v2 – API & data endpoints ──')
  await probe('https://labs-v2.competitor.com/api/events', 'labs-v2 /api/events')
  await probe('https://labs-v2.competitor.com/api/events?search=frankfurt', 'labs-v2 /api/events?search=frankfurt')
  await probe('https://labs-v2.competitor.com/api/events?year=2025', 'labs-v2 /api/events?year=2025')

  console.log('\n── ironman.com results pages (pro extrakci UUID) ──')
  await probe('https://www.ironman.com/races/im-frankfurt/results', 'ironman.com im-frankfurt results')
  await probe('https://www.ironman.com/races/im703-hradec-kralove/results', 'ironman.com im703-hradec-kralove results')
  await probe('https://www.ironman.com/races/im703-st-poelten/results', 'ironman.com im703-st-poelten results')
  await probe('https://www.ironman.com/races/im-lanzarote/results', 'ironman.com im-lanzarote results')
  await probe('https://www.ironman.com/races/im-lake-placid/results', 'ironman.com im-lake-placid results')

  console.log('\n── API test s UUID z ironman.com results stránek ──')
  // UUID z /races/im-frankfurt/results: 09d8fbb6-1333-43ca-a1e3-049040f15194
  await probe('https://labs-v2.competitor.com/api/results?wtc_eventid=09d8fbb6-1333-43ca-a1e3-049040f15194', 'API Frankfurt UUID (z ironman.com)')
  // UUID z /races/im703-hradec-kralove/results: c5989e51-7f00-41fb-a6c4-0580a988fc5d
  await probe('https://labs-v2.competitor.com/api/results?wtc_eventid=c5989e51-7f00-41fb-a6c4-0580a988fc5d', 'API Hradec UUID (z ironman.com)')
  // UUID z labs-v2 /results/event/ironman-frankfurt: 48fdddbf-c0b1-4881-98c6-7197fbc12d77
  await probe('https://labs-v2.competitor.com/api/results?wtc_eventid=48fdddbf-c0b1-4881-98c6-7197fbc12d77', 'API labs-v2 frankfurt UUID')
  // UUID z labs-v2 /results/event/ironman-703-hradec-kralove: 0dcdc0c2-8981-4b31-8b36-05e2a718eaa8
  await probe('https://labs-v2.competitor.com/api/results?wtc_eventid=0dcdc0c2-8981-4b31-8b36-05e2a718eaa8', 'API labs-v2 hradec UUID')

  console.log('\n═══════════════════════════════════════════════════')
  console.log('Probe hotovo.')
}

main().catch(console.error)
