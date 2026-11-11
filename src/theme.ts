import { theme, type ThemeConfig } from 'antd'
import type { ThemePreference } from './types'

export type ResolvedTheme = 'light' | 'dark'

const FONT_FAMILY =
  '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif'

/**
 * 浅色 / 深色两套 Ant Design 主题。
 * 深色使用 `darkAlgorithm`，同时保留紧凑密度；组件级 token 覆盖
 * 表头、边框、悬浮行等 CSS 无法直接控制的部分。
 */
export function appTheme(resolved: ResolvedTheme): ThemeConfig {
  const dark = resolved === 'dark'
  return {
    algorithm: dark ? [theme.darkAlgorithm, theme.compactAlgorithm] : theme.compactAlgorithm,
    token: {
      colorPrimary: dark ? '#4c8dff' : '#1f6feb',
      colorInfo: dark ? '#4c8dff' : '#1f6feb',
      colorSuccess: dark ? '#4cc27a' : '#188a4c',
      colorWarning: dark ? '#e0a355' : '#b45309',
      colorError: dark ? '#f06a5e' : '#c0392b',
      colorText: dark ? '#e6e8eb' : '#1a1d21',
      colorTextSecondary: dark ? '#a0a6ae' : '#636b76',
      colorBorder: dark ? '#34363b' : '#e2e5e9',
      colorBorderSecondary: dark ? '#2a2c30' : '#eef0f2',
      colorBgBase: dark ? '#141414' : '#ffffff',
      colorBgContainer: dark ? '#1d1e20' : '#ffffff',
      colorBgElevated: dark ? '#242528' : '#ffffff',
      colorFillAlter: dark ? '#232529' : '#fafbfc',
      borderRadius: 6,
      fontSize: 12,
      controlHeight: 28,
      fontFamily: FONT_FAMILY
    },
    components: {
      Table: {
        headerBg: dark ? '#232529' : '#fafbfc',
        headerColor: dark ? '#a0a6ae' : '#636b76',
        headerSplitColor: 'transparent',
        rowHoverBg: dark ? '#26282b' : '#f8f9fb',
        borderColor: dark ? '#2a2c30' : '#eef0f2',
        colorBgContainer: dark ? '#1d1e20' : '#ffffff',
        cellPaddingBlockSM: 5,
        cellPaddingInlineSM: 8,
        fontSize: 12
      },
      Menu: {
        itemHeight: 24,
        fontSize: 12,
        horizontalItemSelectedColor: dark ? '#79a8ff' : '#1f6feb',
        activeBarHeight: 0
      },
      Modal: {
        titleFontSize: 13,
        contentBg: dark ? '#1d1e20' : '#ffffff',
        headerBg: dark ? '#1d1e20' : '#ffffff'
      },
      Button: { fontSize: 12, paddingInline: 10 },
      Tabs: { fontSize: 12 }
    }
  }
}

/** 浏览器系统偏好；非浏览器环境（测试 / SSR）返回 false。 */
export function getSystemDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 把三态偏好解析为实际主题；`system` 跟随系统。 */
export function resolveThemePreference(
  preference: ThemePreference,
  systemDark: boolean
): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference
  return systemDark ? 'dark' : 'light'
}
