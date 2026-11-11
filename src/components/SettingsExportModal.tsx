import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Modal } from 'antd'

interface Props {
  open: boolean
  onCancel: () => void
  onExport: (includeSecrets: boolean) => Promise<void>
}

export default function SettingsExportModal({ open, onCancel, onExport }: Props) {
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setIncludeSecrets(false)
    setBusy(false)
  }, [open])

  const submit = async () => {
    setBusy(true)
    try {
      await onExport(includeSecrets)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="导出设置"
      width={480}
      onCancel={onCancel}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button type="primary" loading={busy} onClick={() => void submit()}>
            导出
          </Button>
        </div>
      }
    >
      <div className="settings-transfer-hint">
        导出范围包括界面主题、表格列设置、扫描与短片选项、AI 配置、模式配置和文件名黑名单。
        插件配置（<code>data/config.json</code>，含 JavDB 令牌）不在导出范围内。
      </div>
      <Checkbox
        checked={includeSecrets}
        onChange={(event) => setIncludeSecrets(event.target.checked)}
      >
        包含密钥
      </Checkbox>
      <div style={{ marginTop: 12 }}>
        {includeSecrets ? (
          <Alert
            type="warning"
            showIcon
            message="导出文件将包含敏感信息"
            description="AI Key、TMDB Key、Bangumi Token 等会以明文写入文件，请勿分享、上传或提交到仓库。"
          />
        ) : (
          <Alert
            type="info"
            showIcon
            message="默认脱敏"
            description="导出文件不包含任何 API Key 或令牌；导入到其他设备后需要重新填写密钥。"
          />
        )}
      </div>
    </Modal>
  )
}
