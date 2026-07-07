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

async function probeDeep(url, label) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const r = await fetch(url, { headers: BASE_HEADERS, signal: ctrl.signal, redirect: 'manual' })
    clearTimeout(timer)
    console.log(`${r.status < 400 ? '✓' : '✗'} [${r.status}] ${label}`)
    if (r.status === 200) {
      const text = await r.text()
      console.log(`    len:${text.length}`)

      // Search for event ID / labs-v2 patterns
      const searches = [
        { name: 'labs-v2 URL', re: /labs-v2\.competitor\.com[^\s"'<]{5,100}/gi },
        { name: 'wtc_eventid', re: /wtc_?event_?id[^\s"'<]{0,60}/gi },
        { name: 'eventId param', re: /eventId[^\s"'<]{0,60}/gi },
        { name: 'data-event', re: /data-event[^\s"'<]{0,80}/gi },
        { name: 'iframe labs', re: /<iframe[^>]{0,200}labs-v2[^>]{0,200}>/gi },
        { name: 'Results config', re: /Results\.[a-z]{0,20}\([^)]{0,200}\)/gi },
        { name: 'wtcEvent', re: /wtcEvent[^\s"'<]{0,60}/gi },
        { name: 'event_slug', re: /event_?slug[^\s"'<]{0,60}/gi },
        { name: 'sportstats API', re: /sportstats[^\s"'<]{0,80}/gi },
        { name: '"event":{', re: /"event"\s*:\s*\{[^}]{0,150}/g },
        { name: 'apiUrl', re: /apiUrl[^\s"'<]{0,80}/gi },
        { name: 'resultsUrl', re: /resultsUrl[^\s"'<]{0,80}/gi },
      ]
      let found = false
      for (const { name, re } of searches) {
        const matches = [...text.matchAll(re)].slice(0, 3)
        if (matches.length) {
          found = true
          console.log(`    [${name}] ${matches.map(m => m[0].replace(/\n/g,' ').substring(0,120)).join(' | ')}`)
        }
      }
      if (!found) console.log(`    (no patterns found)`)

      // Also check for __NEXT_DATA__ if present
      if (text.includes('__NEXT_DATA__')) {
        const m = text.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/)
        if (m) {
          try {
            const nd = JSON.parse(m[1])
            const pp = nd.props?.pageProps
            if (pp) {
              for (const k of Object.keys(pp)) {
                const v = pp[k]
                if (Array.isArray(v) && v.length > 0) {
                  console.log(`    pageProps.${k}: Array(${v.length}) [0]=${JSON.stringify(v[0]).substring(0,200)}`)
                } else if (!Array.isArray(v)) {
                  console.log(`    pageProps.${k}: ${JSON.stringify(v)?.substring(0,100)}`)
                }
              }
            }
          } catch {}
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

  console.log('\n── DEEP SCAN: ironman.com results pages ──')
  await probeDeep('https://www.ironman.com/races/im-frankfurt/results', 'ironman.com im-frankfurt/results')
  await probeDeep('https://www.ironman.com/races/im703-hradec-kralove/results', 'ironman.com im703-hradec-kralove/results')
  await probeDeep('https://www.ironman.com/races/im-lanzarote/results', 'ironman.com im-lanzarote/results')

  console.log('\n── DEEP SCAN: sportstats.one ──')
  await probeDeep('https://sportstats.one/event/ironman-frankfurt', 'sportstats.one ironman-frankfurt')
  await probeDeep('https://sportstats.one/event/ironman-703-czech-republic', 'sportstats.one ironman-703-czech-republic')

  console.log('\n═══════════════════════════════════════════════════')
  console.log('Probe hotovo.')
}

main().catch(console.error)
