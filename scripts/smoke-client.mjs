/**
 * smoke-client.mjs —— lib/client.js 的无浏览器冒烟测试。
 *
 * 在 Node 里模拟 ModuleLoader：捕获 bundle 的 { id, factory }，用假 ctx 执行 apply，
 * 断言它注册进了官方 slot（main + sidebar.panellist），并把面板组件渲染一次。
 * 覆盖"注册契约"，不覆盖浏览器里的真实渲染与交互。
 *
 * 用法：pnpm run smoke:client（先 pnpm build）
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const BUNDLE_ID = 'dsh-session-finder'
const PANEL_ID = 'session-finder'
const checks = []
const check = (label, ok, detail) => {
  checks.push({ label, ok })
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : ' — ' + detail))
}

// ── 加载 bundle（它调用 window.__ModuleLoader__.load）────────────
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
let loaded
const fakeWindow = { __ModuleLoader__: { load: (entry) => { loaded = entry } } }
const fakeDocument = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, appendChild() {} }),
  head: { appendChild: () => {} },
}
new Function('window', 'document', source)(fakeWindow, fakeDocument)
check('bundle 注册了 __ModuleLoader__ id', loaded?.id === BUNDLE_ID, loaded?.id)

const stubRequire = (spec) => {
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return {}
  if (spec === 'react' || spec.startsWith('react/') || spec.startsWith('react-dom')) return require(spec)
  throw new Error('unexpected require: ' + spec)
}
const mod = loaded.factory(stubRequire)
check('导出 apply', typeof mod.apply === 'function')
check('inject 含 slots', Array.isArray(mod.inject) && mod.inject.includes('slots'), JSON.stringify(mod.inject))

// ── 用假 ctx 执行 apply ────────────────────────────────────────
const injected = []
const registrations = []
const calls = []
let locale = 'zh-CN'
const ctx = {
  connection: { rpc: { call: async () => ({ ok: true, value: null }) } },
  sessions: { open: (id) => calls.push(['open', id]), list: { getSnapshot: () => ({ current: undefined }) } },
  slots: {
    inject: (name, callback) => { injected.push(name); return callback() },
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  },
  get: (service) => service === 'locale'
    ? { subscribe: () => () => {}, getSnapshot: () => ({ active: locale, revision: 1 }) }
    : service === 'layout' ? { selectPanel: (id) => calls.push(['selectPanel', id]) } : undefined,
  effect: () => {},
}
mod.apply(ctx)

check('注入 main 与 sidebar.panellist', injected.join(',') === 'main,sidebar.panellist', JSON.stringify(injected))
const panel = registrations.find((entry) => entry.options.name === 'main')
const row = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
check('main 注册 key = ' + PANEL_ID, panel?.options.key === PANEL_ID)
check('侧栏行 id 与 order', row?.options.id === PANEL_ID && row?.options.order === 10)
check('侧栏行 label 跟随 locale（zh）', row?.options.label() === '会话查找')
check('侧栏行 label 跟随 locale（en）', (locale = 'en-US', row?.options.label() === 'Session Finder'))

// ── inject face 与面板渲染 ─────────────────────────────────────
const props = panel.options.inject()
check('inject face 提供面板所需 props',
  typeof props.client === 'object' && typeof props.onOpenSession === 'function' && typeof props.onBack === 'function',
  Object.keys(props).sort().join(','))
props.onBack()
check('onBack 切回 conversation', JSON.stringify(calls.at(-1)) === '["selectPanel","conversation"]', JSON.stringify(calls.at(-1)))

const htmlEn = renderToStaticMarkup(React.createElement(panel.component, { ...props }))
check('面板渲染出搜索/总览页签（en）', htmlEn.includes('Search') && htmlEn.includes('Overview'), htmlEn.length + ' bytes')
check('面板渲染出重建按钮（en）', htmlEn.includes('Rebuild'))
locale = 'zh-CN'
const htmlZh = renderToStaticMarkup(React.createElement(panel.component, { ...props }))
check('面板渲染出搜索/总览页签（zh）', htmlZh.includes('消息检索') && htmlZh.includes('会话总览'))
check('面板渲染出重建按钮（zh）', htmlZh.includes('重建索引'))
check('面板带返回会话按钮', htmlZh.includes('返回会话') && htmlZh.includes('class="sex-back"'))
const icon = renderToStaticMarkup(React.createElement(row.component, { size: 20 }))
check('侧栏图标渲染 svg', icon.startsWith('<svg') && icon.includes('width="20"'), icon.slice(0, 40))

const failed = checks.filter((entry) => !entry.ok)
console.log(failed.length === 0 ? '\nall ' + checks.length + ' checks passed' : '\n' + failed.length + ' check(s) failed')
process.exit(failed.length === 0 ? 0 : 1)
