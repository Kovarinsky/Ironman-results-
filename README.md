# Ironman Czech Results

Scraper výsledků závodů Ironman pro české závodníky (CZE).

Sleduje 18 závodů – české závody, oblíbené zahraniční starty i světové šampionáty.

## Spuštění z mobilu (GitHub Actions)

1. Jděte na záložku **Actions** v tomto repozitáři
2. Vlevo klikněte na **Ironman – čeští závodníci**
3. Klikněte na **Run workflow** a nastavte parametry
4. Po dokončení (cca 5–10 min) stáhněte výsledky ze sekce **Artifacts**

## Spuštění lokálně

```bash
npm install
npx playwright install chromium

npm run scrape:letos     # výsledky 2026
npm run scrape:czech     # 2015–2026
npm run scrape:test      # dry-run (jen zobrazí plán)
npm run scrape:full      # pouze plné Ironman (226 km)
npm run scrape:703       # pouze Ironman 70.3 (113 km)

# vlastní parametry:
node scraper.mjs --from 2018 --to 2023 --full-only
```

## Výstup (`data/`)

| Soubor | Obsah |
|---|---|
| `czech-athletes.csv` | Všechny výsledky pro Excel / Google Sheets |
| `czech-athletes.json` | Strukturovaná data |
| `races-{rok}.json` | Výsledky rozepsané po rocích |

## Sledované závody

**Česká republika:** Ironman CZ, Ironman 70.3 CZ

**Oblíbené zahraniční:** Klagenfurt, Frankfurt, Barcelona, Austria (IM + 70.3), St. Pölten, Gdynia, Zell am See, Hamburg (IM + 70.3), Copenhagen

**Šampionáty:** Hawaii WC, Nice WC, 70.3 WC
