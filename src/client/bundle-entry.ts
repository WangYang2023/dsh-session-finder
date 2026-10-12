/**
 * client/bundle-entry.ts —— ModuleLoader bundle 工厂（打包脚本入口）。
 * scripts/build-client.mjs 把它打包成 lib/client.js（react 外置）。
 *
 * 挂载策略（官方 Slots API，DSH 0.2.x）：
 *  - 侧栏入口：注册进 \`sidebar.panellist\`（全局面板行）。按钮、标签、选中态
 *    都由壳负责，本插件只提供一个图标组件。
 *  - 主面板：注册进 \`main\`（keyed，key 与侧栏行 id 相同）。选中该行时占用中央
 *    列；「返回会话」通过 \`ctx.layout.selectPanel('conversation')\` 切回。
 * 取代早期版本「DOM 注入侧栏按钮 + 覆盖 conversation 列」的做法。
 */

import { createElement } from 'react'
import type { AppProps } from './App.js'
import { App } from './App.js'
import type { ExplorerClient } from './store.js'
import { createExplorerClient } from './store.js'
import type { JumpSessionsLike } from './jump.js'
import type { LocaleServiceLike } from './i18n.js'
import styles from './styles.css'

export const CHANNEL = '/dsh-session-finder'

/** 主面板 key，同时是侧栏行的 id（layout 用同一个 id 把两者关联起来）。 */
const PANEL_ID = 'session-finder'

interface RpcLike {
  call?: (channel: string, method: string, payload?: unknown) => Promise<unknown>
}
interface ConnectionLike {
  rpc?: RpcLike
}
interface SessionsLike {
  open?: (id: string) => void
  /** useSessions 标准 feed（jumpToSession 读 current 判定选中完成）。 */
  list?: { getSnapshot?: () => { current?: string } }
}
interface LocaleLike extends LocaleServiceLike {
  subscribe?: (listener: () => void) => () => void
  getSnapshot?: () => { active: string; revision: number }
}
interface LayoutLike {
  selectPanel?: (panelId: string | null) => void
}
/** 只声明用到的两个成员：注册一个 seat，并等待别人声明它。 */
interface SlotsLike {
  inject: (name: string, callback: () => unknown) => unknown
  register: (options: Record<string, unknown>, component: unknown) => unknown
}
interface ClientCtxLike {
  connection?: ConnectionLike
  sessions?: SessionsLike
  slots?: SlotsLike
  effect?: (dispose: () => unknown, label: string) => void
  /** cordis client ctx：取注入的服务（locale / layout 等）。 */
  get?: (service: string) => unknown
}

/** 侧栏行图标：壳按自己的尺寸请求，标签与选中态由壳渲染。 */
function FinderIcon(props: { size?: number }) {
  const size = typeof props.size === 'number' ? props.size : 18
  return createElement(
    'svg',
    {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    createElement('circle', { cx: 8, cy: 8, r: 6.25 }),
    createElement('path', { d: 'M8 4.75V8l2.25 1.5' }),
  )
}

/** 主面板：框架 props（useSessions / usePanelInfo 等）与 inject face 合并后透传。 */
function FinderPanel(props: Record<string, unknown>) {
  return createElement(App, props as unknown as AppProps)
}

/** ModuleLoader factory：返回 { apply, inject }。 */
export function factory(require: (spec: string) => unknown) {
  const bundleModule = { exports: {} as Record<string, unknown> }
  Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: 'Module' })

  function apply(ctx: ClientCtxLike) {
    if (typeof document === 'undefined') return
    const slots = ctx.slots
    if (!slots) return
    const Tooltip = (require('@deepseek-ai/dsh-client-ui-primitives') as { Tooltip?: unknown })?.Tooltip

    // DSH Host locale 服务（注入词 @deepseek-ai/dsh-client-locale；缺省回退 navigator.language）
    const locale = ctx.get?.('locale') as LocaleLike | undefined

    const client: ExplorerClient = createExplorerClient(ctx.connection, CHANNEL)
    const backToConversation = (): void => {
      ;(ctx.get?.('layout') as LayoutLike | undefined)?.selectPanel?.('conversation')
    }
    const onOpenSession = (sessionId: string): void => {
      ctx.sessions?.open?.(sessionId)
      backToConversation()
    }

    // CSS 幂等注入（slot 只提供 seat，样式仍由插件自带）
    const tagId = 'dsh-session-finder/styles.css'
    if (document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.pluginCss = tagId
      tag.textContent = styles
      document.head.appendChild(tag)
    }

    // 侧栏行标签跟随 locale（中文「会话查找」/ 英文 "Session Finder"）
    const entryLabel = (): string => {
      const active = locale?.getSnapshot?.()?.active
      return typeof active === 'string' && active.length > 0 && !active.toLowerCase().startsWith('zh')
        ? 'Session Finder'
        : '会话查找'
    }

    const injected: Omit<AppProps, 'store'> = {
      client,
      onOpenSession,
      sessions: ctx.sessions as JumpSessionsLike | undefined,
      onBack: backToConversation,
      Tooltip,
      locale,
    }

    // 两个 seat 都走 slots.inject：等待壳先声明 slot，声明消失时自动摘除。
    slots.inject('main', () => slots.register(
      { name: 'main', key: PANEL_ID, inject: () => injected },
      FinderPanel,
    ))
    slots.inject('sidebar.panellist', () => slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 10,
      label: entryLabel,
    }, FinderIcon))
  }

  bundleModule.exports.apply = apply
  bundleModule.exports.inject = ['connection', 'sessions', 'locale', 'slots']
  return bundleModule.exports
}
