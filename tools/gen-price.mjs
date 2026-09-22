import { readFileSync, writeFileSync } from 'node:fs'
globalThis.DOMParser = (await import('jsdom')).JSDOM && new (await import('jsdom')).JSDOM().window.DOMParser
const c = JSON.parse(readFileSync('/home/va/Documents/code/baduchai/public/catalog.json'))
const { buildPriceTemplate } = await import('/home/va/Documents/code/baduchai/src/lib/xlsx.ts')
const bytes = buildPriceTemplate(c.products, '22 сентября 2026 г.')
writeFileSync('/tmp/prays.xlsx', bytes)
console.log('создан /tmp/prays.xlsx', (bytes.length/1024).toFixed(1), 'КБ')
