// Regenerates the README demo assets (docs/demo.gif + stills) by driving the
// deterministic offline Mock demo with a real browser: no manual screen
// recording, no API key. Rerun this after UI changes to refresh the assets.
//
// One-time setup (kept out of the app's dependencies on purpose):
//   npm i -D playwright pngjs gifenc && npx playwright install chromium
// Then, with the dev server running (pnpm dev):
//   node docs/record-demo.cjs

const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const { PNG } = require('pngjs')
const { GIFEncoder, quantize, applyPalette } = require('gifenc')

const URL = process.env.DEMO_URL || 'http://localhost:5173'
const OUT = __dirname

// Values the "user" types, chosen to read naturally on screen.
const BOOKING = { date: '2026-08-21', sport: 'Tennis', players: '4', notes: 'Outdoor court if possible' }
const SLOT = { slot: '17:00', duration: '90 min' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function scrollBottom(page) {
  await page.evaluate(() => {
    const t = document.querySelector('.transcript')
    if (t) t.scrollTop = t.scrollHeight
    window.scrollTo(0, document.body.scrollHeight)
  })
}

// The active form is the last one not yet frozen into a receipt.
const activeForm = (page) => page.locator('form.adhoc-form:not(.is-submitted)').last()

async function fillBooking(page, tick) {
  const form = activeForm(page)
  await form.locator('input[type=date]').fill(BOOKING.date);      await tick()
  await form.locator('select').selectOption(BOOKING.sport);       await tick()
  await form.locator('input[type=number]').fill(BOOKING.players); await tick()
  await form.locator('input[type=text]').fill(BOOKING.notes);     await tick()
  await form.locator('input[type=checkbox]').check();             await tick()
}

async function fillSlot(page, tick) {
  const form = activeForm(page)
  const selects = form.locator('select')
  await selects.nth(0).selectOption(SLOT.slot);       await tick()
  await selects.nth(1).selectOption(SLOT.duration);   await tick()
  await form.locator('input[type=checkbox]').check(); await tick()
}

// The scripted conversation. `tick` drives GIF frame capture; `still(name)`
// grabs a crisp screenshot at a few key moments.
async function runFlow(page, { tick = async () => {}, still = async () => {} }) {
  const wait = async (ms) => {
    const end = Date.now() + ms
    while (Date.now() < end) { await scrollBottom(page); await tick(); await sleep(70) }
  }

  // Live mode injects a full-page CopilotKit dev inspector that eats pointer
  // events; hide it and force the single click that leaves Live for Mock.
  await page.addStyleTag({ content: 'cpk-web-inspector{display:none!important;pointer-events:none!important}' })
  await page.getByRole('button', { name: 'Mock demo' }).click({ force: true })

  await wait(1700)
  await still('01-streaming')
  await wait(1700)
  await page.waitForSelector('form.adhoc-form:not(.is-streaming) button.form-submit:not([disabled])')
  await wait(500)

  await fillBooking(page, async () => { await scrollBottom(page); await tick(); await sleep(120) })
  await wait(500)
  await still('02-filled')

  await activeForm(page).locator('button.form-submit').click()
  await wait(2600)
  await page.waitForSelector('form.adhoc-form:not(.is-streaming) button.form-submit:not([disabled])')
  await still('03-dialogue')
  await wait(400)

  await fillSlot(page, async () => { await scrollBottom(page); await tick(); await sleep(120) })
  await wait(400)
  await activeForm(page).locator('button.form-submit').click()
  await wait(2200)
  await still('04-done')
  await wait(700)
}

async function stillsPass(browser) {
  const ctx = await browser.newContext({ viewport: { width: 860, height: 1180 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'networkidle' })
  await runFlow(page, {
    still: async (name) => {
      await scrollBottom(page)
      await page.screenshot({ path: path.join(OUT, `${name}.png`) })
      console.log('  still', name)
    },
  })
  await ctx.close()
}

async function gifPass(browser) {
  const ctx = await browser.newContext({ viewport: { width: 720, height: 840 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'networkidle' })
  const frames = []
  await runFlow(page, { tick: async () => { frames.push(await page.screenshot({ type: 'png' })) } })
  await ctx.close()
  console.log(`  captured ${frames.length} raw frames`)
  encodeGif(frames, path.join(OUT, 'demo.gif'))
}

function encodeGif(frameBuffers, outPath) {
  const DELAY = 90
  const decoded = frameBuffers.map((b) => PNG.sync.read(b))
  const { width, height } = decoded[0]

  // One global palette from a busy mid-run frame keeps the file small and
  // avoids per-frame palette flicker; the UI has a small, stable color set.
  const mid = decoded[Math.floor(decoded.length * 0.55)]
  const palette = quantize(mid.data, 256, { format: 'rgb565' })

  const gif = GIFEncoder()
  let pending = null // identical consecutive frames extend one delay
  let prevKey = null
  for (const png of decoded) {
    const key = Buffer.from(png.data).toString('latin1')
    if (key === prevKey && pending) { pending.delay += DELAY; continue }
    if (pending) gif.writeFrame(pending.index, width, height, { palette, delay: pending.delay })
    pending = { index: applyPalette(png.data, palette, 'rgb565'), delay: DELAY }
    prevKey = key
  }
  if (pending) gif.writeFrame(pending.index, width, height, { palette, delay: pending.delay })
  gif.finish()
  fs.writeFileSync(outPath, Buffer.from(gif.bytes()))
  console.log(`  wrote ${outPath} (${width}x${height}, ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`)
}

;(async () => {
  const browser = await chromium.launch()
  console.log('stills pass...'); await stillsPass(browser)
  console.log('gif pass...');    await gifPass(browser)
  await browser.close()
  console.log('done.')
})().catch((e) => { console.error(e); process.exit(1) })
