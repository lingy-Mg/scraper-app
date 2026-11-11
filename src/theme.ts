import { theme, type ThemeConfig } from 'antd'

export const appTheme: ThemeConfig = {
  algorithm: theme.compactAlgorithm,
  token: {
    colorPrimary: '#1f6feb',
    colorInfo: '#1f6feb',
    colorSuccess: '#188a4c',
    colorWarning: '#b45309',
    colorError: '#c0392b',
    colorText: '#1a1d21',
    colorTextSecondary: '#636b76',
    colorBorder: '#e2e5e9',
    colorBorderSecondary: '#eef0f2',
    borderRadius: 6,
    fontSize: 12,
    controlHeight: 28,
    fontFamily:
      '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif'
  },
  components: {
    Table: {
      headerBg: '#fafbfc',
      headerColor: '#636b76',
      headerSplitColor: 'transparent',
      rowHoverBg: '#f8f9fb',
      borderColor: '#eef0f2',
      cellPaddingBlockSM: 5,
      cellPaddingInlineSM: 8,
      fontSize: 12
    },
    Menu: {
      itemHeight: 24,
      fontSize: 12,
      horizontalItemSelectedColor: '#1f6feb',
      activeBarHeight: 0
    },
    Modal: { titleFontSize: 13 },
    Button: { fontSize: 12, paddingInline: 10 },
    Tabs: { fontSize: 12 }
  }
}
