import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { chromium } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Read only the animation class literals in these two public UI components.
// The tests exercise generated CSS, so a selector-order regression cannot pass
// merely because a component still contains the expected class names.
function animationClasses(relative) {
  const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const classes = []
  function visit(node) {
    if (ts.isStringLiteral(node) && node.text.includes('data-[state=open]:animate-in')) classes.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return classes
}
const selects = animationClasses('src/components/ui/select.tsx')
const toasts = animationClasses('src/components/ui/toast.tsx')
let browser, page
before(async () => {
  const assets = path.join(root, 'dist/assets')
  const files = fs.readdirSync(assets).filter(name => /^index-.*\.css$/.test(name))
  assert.equal(files.length, 1, 'build must provide exactly one main stylesheet')
  const css = fs.readFileSync(path.join(assets, files[0]), 'utf8')
  browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'chrome' } : {}), headless: true })
  page = await browser.newPage({ reducedMotion: 'reduce' })
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addStyleTag({ content: css })
})
after(async () => { await browser?.close() })
async function variables(className, attrs) {
  return page.evaluate(({ className, attrs }) => {
    const element = document.createElement('div')
    element.className = className
    Object.assign(element.dataset, attrs)
    element.style.setProperty('transition', 'none', 'important')
    document.body.append(element)
    const style = getComputedStyle(element)
    const properties = ['--tw-enter-translate-x', '--tw-enter-translate-y', '--tw-exit-translate-x', '--tw-exit-opacity']
    const result = Object.fromEntries(properties.map(name => [name, style.getPropertyValue(name).trim()]))
    element.remove()
    return result
  }, { className, attrs })
}
test('the select keeps all four original slide offsets when open', async () => {
  assert.equal(selects.length, 1)
  const sides = { bottom: ['y', '-0.5rem'], top: ['y', '0.5rem'], left: ['x', '0.5rem'], right: ['x', '-0.5rem'] }
  for (const classes of selects) for (const [side, [axis, expected]] of Object.entries(sides)) {
    const actual = await variables(classes, { state: 'open', side })
    assert.match(actual[`--tw-enter-translate-${axis}`], /rem$/, side)
    assert.equal(parseFloat(actual[`--tw-enter-translate-${axis}`]), parseFloat(expected), side)
  }
})
test('a closed swiped toast keeps its original exit slide and fade', async () => {
  assert.equal(toasts.length, 1)
  for (const swipe of ['', 'end']) {
    const actual = await variables(toasts[0], { state: 'closed', swipe })
    assert.equal(actual['--tw-exit-translate-x'], '100%', swipe)
    assert.equal(Number(actual['--tw-exit-opacity']), 0.8, swipe)
  }
  const openSwipe = await variables(toasts[0], { state: 'open', swipe: 'end' })
  assert.equal(openSwipe['--tw-exit-translate-x'], '')
  assert.equal(openSwipe['--tw-exit-opacity'], '')
})
