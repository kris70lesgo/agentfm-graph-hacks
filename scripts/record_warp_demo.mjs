import { chromium } from '../warp-desktop/node_modules/@playwright/test/index.mjs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright')
const browserPath = '/Users/agastya/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'

const api = async (port, route, body) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, body: await response.json() }
}

const waitForReservation = async (timeoutMs = 12_000) => {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const result = await api(8081, '/v1/graph/reservations')
    if (result.body.reservations?.length) return result.body.reservations
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('No shared reservation appeared in Boss B')
}

await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: browserPath })
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: out, size: { width: 1600, height: 900 } },
  reducedMotion: 'reduce',
})
const page = await context.newPage()
const raw = path.join(out, 'warp-demo-raw.webm')

try {
  await page.goto('http://127.0.0.1:5173/demo.html?apiPort=8080', { waitUntil: 'networkidle' })
  await page.locator('.graph-topology-card').waitFor({ state: 'visible' })
  await page.getByText('FalkorDB is connected').waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(1400)

  await page.getByRole('button', { name: /Trace route/ }).click()
  await page.getByText(/candidate|eligible worker|route/i).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(1500)

  await page.evaluate(() => document.querySelector('#graph-prompt')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  await page.waitForTimeout(850)
  await page.locator('#graph-prompt').fill('Plan a compact release with owners, checkpoints, and the main risks.')
  await page.getByRole('button', { name: /Run graph-routed task/ }).click()
  await page.locator('.graph-dispatch-result').waitFor({ state: 'visible', timeout: 28_000 })
  await page.getByText(/Delivery plan/i).waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {})
  await page.waitForTimeout(1600)

  const workerList = await api(8080, '/api/workers')
  const nova = workerList.body.agents.find((worker) => worker.name === 'Nova Planner')
  if (!nova) throw new Error('Nova Planner is not online')

  // Hold a real worker task briefly while the other Boss observes its graph claim.
  const heldTask = api(8080, '/v1/chat/completions', {
    model: nova.peer_id,
    messages: [{ role: 'user', content: 'DEMO_HOLD Generate a two-line launch checklist.' }],
    stream: false,
  })
  await waitForReservation()
  await page.goto('http://127.0.0.1:5173/demo.html?apiPort=8081', { waitUntil: 'networkidle' })
  await page.getByText('FalkorDB is connected').waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('#coordination-title').scrollIntoViewIfNeeded()
  await page.getByText('Reserved', { exact: true }).waitFor({ state: 'visible', timeout: 8_000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: path.join(out, 'warp-coordination.png') })
  await heldTask

  await page.getByText('All worker capacity is available').waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {})
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await page.waitForTimeout(1300)
  await page.screenshot({ path: path.join(out, 'warp-graph-context.png'), fullPage: true })
  await page.waitForTimeout(1800)
} finally {
  const video = page.video()
  await context.close()
  if (video) await video.saveAs(raw)
  await browser.close()
}

console.log(`Saved ${raw}`)
