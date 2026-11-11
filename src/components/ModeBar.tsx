import { Button, Segmented } from 'antd'
import type { ModeConfig, ModeKey } from '../types'

interface Props {
  mode: ModeKey
  modes: ModeConfig[]
  config: ModeConfig
  pluginSource: 'builtin' | 'bun'
  onChange: (mode: ModeKey) => void
  onConfig: () => void
}

export default function ModeBar({
  mode,
  modes,
  config,
  pluginSource,
  onChange,
  onConfig
}: Props) {
  const enabled = config.sources
    .filter((s) => s.on)
    .map((s) => s.label)
    .join(' · ')

  return (
    <div className="modebar">
      <span className="mlabel">模式</span>
      <Segmented
        size="small"
        value={mode}
        onChange={(v) => onChange(v as ModeKey)}
        options={modes.map((item) => ({ label: item.name, value: item.key }))}
      />
      <div className="mode-right">
        <span
          title={pluginSource === 'bun' ? '模式由 Bun 插件宿主注册' : 'Bun 未连接，使用内置模式'}
          style={{ color: pluginSource === 'bun' ? 'var(--green)' : 'var(--muted-2)' }}
        >
          ● {pluginSource === 'bun' ? '插件' : '内置'}
        </span>
        <span>{enabled}</span>
        {config.version && (
          <span style={{ color: 'var(--muted-2)' }} title="插件版本">
            v{config.version}
          </span>
        )}
        <Button
          type="link"
          size="small"
          style={{ padding: 0, height: 'auto' }}
          onClick={onConfig}
          title={config.settingsUrl ? '设置界面由插件提供（Bun 托管）' : '内置设置'}
        >
          配置…
        </Button>
      </div>
    </div>
  )
}
