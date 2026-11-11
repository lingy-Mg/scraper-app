import { useEffect, useState } from 'react'
import { Button, Checkbox, Modal } from 'antd'
import {
  COLUMN_LABELS,
  HIDEABLE_COLUMN_KEYS,
  type HideableColumnKey
} from '../tableColumns'

interface Props {
  open: boolean
  hidden: string[]
  codeLabel: string
  titleLabel: string
  onCancel: () => void
  onSave: (hidden: string[]) => void
}

const labelOf = (key: HideableColumnKey, codeLabel: string, titleLabel: string) =>
  key === 'code' ? codeLabel : key === 'title' ? titleLabel : COLUMN_LABELS[key]

export default function ColumnSettingsModal({
  open,
  hidden,
  codeLabel,
  titleLabel,
  onCancel,
  onSave
}: Props) {
  const [visible, setVisible] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setVisible(HIDEABLE_COLUMN_KEYS.filter((key) => !hidden.includes(key)))
  }, [open, hidden])

  const options = HIDEABLE_COLUMN_KEYS.map((key) => ({
    value: key,
    label: labelOf(key, codeLabel, titleLabel)
  }))

  return (
    <Modal
      open={open}
      title="列设置"
      width={440}
      onCancel={onCancel}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            size="small"
            onClick={() => setVisible([...HIDEABLE_COLUMN_KEYS])}
          >
            全部显示
          </Button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button onClick={onCancel}>取消</Button>
            <Button
              type="primary"
              onClick={() =>
                onSave(HIDEABLE_COLUMN_KEYS.filter((key) => !visible.includes(key)))
              }
            >
              保存
            </Button>
          </div>
        </div>
      }
    >
      <div className="col-settings-hint">
        勾选要显示的列；「操作」与「选择」列始终显示，不受影响。
      </div>
      <Checkbox.Group
        className="col-settings-group"
        value={visible}
        options={options}
        onChange={(values) => setVisible(values as string[])}
      />
    </Modal>
  )
}
