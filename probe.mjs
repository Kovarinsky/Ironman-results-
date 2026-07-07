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
            // Print full JSON if it contains subevents (for debugging)
            if (pp?.subevents?.length > 0 || pp?.latestResults?.length > 0) {
              console.log(`    FULL ND: ${m[1].substring(0, 2000)}`)
            }
          } catch (e) {
            console.log(`    ND parse error: ${e.message}`)
            console.log(`    ND raw (200 chars): ${m[1].substring(0, 200)}`)
          }
        }
      }

      // For short non-HTML responses, print raw
      if (text.length < 3000 && !hasNextData) {
        console.log(`    raw: ${text.substring(0, 800).replace(/\n/g, ' ')}`)
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

  console.log('\n── labs-v2: _next/data endpoint (buildId=1782166264455) ──')
  await probe('https://labs-v2.competitor.com/_next/data/1782166264455/results/event/ironman-frankfurt.json', '_next/data ironman-frankfurt')
  await probe('https://labs-v2.competitor.com/_next/data/1782166264455/results/event/ironman-703-hradec-kralove.json', '_next/data ironman-703-hradec-kralove')

  console.log('\n── labs-v2: alternativní API patterny ──')
  await probe('https://labs-v2.competitor.com/api/results?wtc_eventid=test', 'API dummy (baseline 143 bytes)')
  await probe('https://labs-v2.competitor.com/api/race-results?eventId=im-frankfurt', 'API race-results (staré)')
  await probe('https://labs-v2.competitor.com/api/event?slug=ironman-frankfurt', 'API event by slug')
  await probe('https://labs-v2.competitor.com/api/wtc_events', 'API wtc_events list')
  await probe('https://labs-v2.competitor.com/api/subevents?eventslug=ironman-frankfurt', 'API subevents')
  await probe('https://labs-v2.competitor.com/api/subevents?slug=ironman-frankfurt', 'API subevents alt')

  console.log('\n── sportstats.one: struktura dat ──')
  await probe('https://sportstats.one/event/ironman-frankfurt', 'sportstats ironman-frankfurt')
  await probe('https://www.ironman.com/races/im-frankfurt/results', 'ironman.com im-frankfurt results (obsah)')

  console.log('\n═══════════════════════════════════════════════════')
  console.log('Probe hotovo.')
}

main().catch(console.error)
