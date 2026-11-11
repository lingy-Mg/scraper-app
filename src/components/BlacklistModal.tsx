import { useEffect, useState } from 'react'
import { Button, Empty, Input, Modal } from 'antd'
import { CloseOutlined, PlusOutlined } from '@ant-design/icons'
import { normalizeBlacklist } from '../utils'

interface Props {
  open: boolean
  patterns: string[]
  onCancel: () => void
  onSave: (patterns: string[]) => void
}

/**
 * 文件名黑名单：按文件名（不含路径）屏蔽 BT 附带文件。
 * 只影响扫描与列表展示，不会删除任何文件。
 */
export default function BlacklistModal({ open, patterns, onCancel, onSave }: Props) {
  const [list, setList] = useState<string[]>(patterns)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!open) return
    setList(patterns)
    setDraft('')
  }, [open, patterns])

  const add = () => {
    const value = draft.trim()
    if (!value) return
    setList((prev) => normalizeBlacklist([...prev, value]))
    setDraft('')
  }

  return (
    <Modal
      open={open}
      title={`文件名黑名单（${list.length}）`}
      width={620}
      okText="保存"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => onSave(normalizeBlacklist(list))}
    >
      <div className="field">
        <label>添加文件名或通配符</label>
        <div className="blacklist-add">
          <Input
            value={draft}
            placeholder="例如 sample、*广告*、preview-*"
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={add}
          />
          <Button icon={<PlusOutlined />} onClick={add} disabled={!draft.trim()}>
            添加
          </Button>
        </div>
      </div>

      <div className="blacklist-hint">
        不区分大小写，支持 <code>*</code>（任意长度）和 <code>?</code>（单个字符）。
        不含通配符时按「包含」匹配：<code>sample</code> 会命中 <code>sample.mp4</code>、
        <code>my-sample.mkv</code>。命中的文件在扫描时直接跳过、列表中隐藏，
        <b>不会删除文件</b>。
      </div>

      <div className="blacklist-list">
        {list.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有拉黑任何文件名" />
        ) : (
          list.map((pattern) => (
            <div className="blacklist-item" key={pattern}>
              <span className="pattern" title={pattern}>
                {pattern}
              </span>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                aria-label={`移除 ${pattern}`}
                onClick={() => setList((prev) => prev.filter((item) => item !== pattern))}
              />
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}
