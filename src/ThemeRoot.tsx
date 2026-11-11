import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { appTheme, getSystemDark, resolveThemePreference } from './theme'
import type { ThemePreference } from './types'

interface ThemeContextValue {
  /** 用户偏好（三态）。 */
  preference: ThemePreference
  /** 实际生效的浅色 / 深色。 */
  resolved: 'light' | 'dark'
  /** 修改偏好；立即生效，是否持久化由调用方决定。 */
  setPreference: (value: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: 'system',
  resolved: 'light',
  setPreference: () => {}
})

export function useThemePreference(): ThemeContextValue {
  return useContext(ThemeContext)
}

/**
 * 主题根节点：承载 ConfigProvider + AntdApp，让 App 内部既能调用
 * Ant Design 静态上下文，也能读取 / 修改主题偏好。
 *
 * 初始偏好固定为 `system`，首屏由 index.html 的内联脚本按系统偏好
 * 预先设置 `data-theme`，避免深色系统下闪白；设置加载完成后再由
 * App 应用持久化的偏好。
 */
export default function ThemeRoot({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>('system')
  const [systemDark, setSystemDark] = useState<boolean>(() => getSystemDark())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    setSystemDark(media.matches)
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [])

  const resolved = resolveThemePreference(preference, systemDark)
  const config = useMemo(() => appTheme(resolved), [resolved])

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved]
  )

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider locale={zhCN} theme={config}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}
