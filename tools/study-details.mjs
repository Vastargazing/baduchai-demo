import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await (await b.newContext({ viewport: { width: 1440, height: 1200 } })).newPage()
await p.goto('https://baduchai.ru/', { waitUntil: 'domcontentloaded', timeout: 90000 })
await p.waitForTimeout(6000)
const out = await p.evaluate(() => {
  const g = (sel, props) => {
    const el = document.querySelector(sel); if (!el) return null
    const s = getComputedStyle(el)
    return Object.fromEntries(props.map((k) => [k, s[k]]))
  }
  const imgs = [...document.querySelectorAll('header img, .logo img, #logo img, a.brand img')]
    .map((i) => ({ src: i.src, w: i.naturalWidth, h: i.naturalHeight, cls: i.className }))
  // фоновые картинки
  const bgs = [...document.querySelectorAll('body, #page, .site, main, .content')]
    .map((e) => ({ tag: e.tagName + '.' + e.className, bg: getComputedStyle(e).backgroundImage,
                   color: getComputedStyle(e).backgroundColor }))
    .filter((x) => x.bg && x.bg !== 'none')
  // карточка товара
  const card = document.querySelector('.product, li.product, .product-item')
  const title = card?.querySelector('h2,h3,.woocommerce-loop-product__title')
  const price = card?.querySelector('.price, .amount')
  const navItem = document.querySelector('.menu-item > a, nav li a')
  const navBox = navItem?.closest('li')
  return {
    imgs,
    bgs,
    navLink: navItem ? { ...Object.fromEntries(['fontFamily','fontSize','fontWeight','textTransform','letterSpacing','color','padding'].map(k=>[k,getComputedStyle(navItem)[k]])) } : null,
    navLi: navBox ? Object.fromEntries(['border','borderTop','borderLeft','background','padding','minWidth'].map(k=>[k,getComputedStyle(navBox)[k]])) : null,
    cardTitle: title ? Object.fromEntries(['fontFamily','fontSize','fontWeight','color','lineHeight'].map(k=>[k,getComputedStyle(title)[k]])) : null,
    cardPrice: price ? Object.fromEntries(['fontFamily','fontSize','fontWeight','color'].map(k=>[k,getComputedStyle(price)[k]])) : null,
    cardBox: card ? Object.fromEntries(['border','background','padding','boxShadow'].map(k=>[k,getComputedStyle(card)[k]])) : null,
    resultsText: document.querySelector('.woocommerce-result-count')?.textContent?.trim(),
    sample: card?.innerHTML?.slice(0, 700),
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
