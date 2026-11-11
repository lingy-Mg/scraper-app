import { useEffect, useRef, useState } from 'react'
import { App as AntdApp, Button, Checkbox, Input, Modal, Select } from 'antd'
import type { InputRef } from 'antd'
import type { ModeConfig, OrganizeOptions, Row } from '../types'
import { buildPath, errText, fmtSize, withExt } from '../utils'
import { native } from '../native'

const TOKENS = ['{片商}', '{年份}', '{番号}', '{标题}', '{演员}', '{时长}', '{剧名}', '{季}', '{集}']

const ACTION_LABEL: Record<OrganizeOptions['action'], string> = {
  move: '移动',
  copy: '复制'
}

interface Props {
  open: boolean
  config: ModeConfig
  rows: Row[]
  onCancel: () => void
  onRun: (options: OrganizeOptions) => void | Promise<void>
}

export default function OrganizeModal({ open, config, rows, onCancel, onRun }: Props) {
  const { message } = AntdApp.useApp()
  const [dest, setDest] = useState('')
  const [tpl, setTpl] = useState(config.organize)
  const [action, setAction] = useState<OrganizeOptions['action']>('move')
  const [conflict, setConflict] = useState<OrganizeOptions['conflict']>('skip')
  const [rmEmpty, setRmEmpty] = useState(true)
  const [picking, setPicking] = useState(false)
  const [running, setRunning] = useState(false)
  const inputRef = useRef<InputRef>(null)

  useEffect(() => {
    if (open) setTpl(config.organize)
  }, [open, config.organize])

  const done = rows.filter((r) => r.status === 'done')
  const skip = rows.filter((r) => r.status !== 'done')
  const total = done.reduce((sum, r) => sum + r.size, 0)
  const sample = done.length ? withExt(buildPath(tpl, done[0])) : '—'

  const insert = (token: string) => {
    const el = inputRef.current?.input
    if (!el) {
      setTpl((t) => t + token)
      return
    }
    const start = el.selectionStart ?? tpl.length
    const end = el.selectionEnd ?? start
    setTpl(tpl.slice(0, start) + token + tpl.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  const pickDest = async () => {
    setPicking(true)
    try {
      const picked = await native.pickFolder()
      if (picked) setDest(picked)
    } catch (error) {
      message.error(`无法选择目标目录：${errText(error)}`)
    } finally {
      setPicking(false)
    }
  }

  const submit = async () => {
    if (!dest.trim() || running) return
    setRunning(true)
    try {
      await onRun({ dest: dest.trim(), tpl, action, conflict, rmEmpty })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="整理文件"
      width={680}
      footer={
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            将整理 <b>{done.length}</b> 个文件 · <b>{fmtSize(total)}</b>
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button onClick={onCancel}>取消</Button>
            <Button
              type="primary"
              disabled={!dest.trim()}
              loading={running}
              onClick={() => void submit()}
            >
              开始整理
            </Button>
          </div>
        </div>
      }
    >
      <div className="dlg-body">
        <div className="field">
          <label>目标目录</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <Input
              value={dest}
              placeholder="选择或输入目标目录的绝对路径"
              onChange={(e) => setDest(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
            />
            <Button loading={picking} onClick={pickDest}>
              选择…
            </Button>
          </div>
        </div>

        <div className="field">
          <label>命名规则</label>
          <Input
            ref={inputRef}
            value={tpl}
            onChange={(e) => setTpl(e.target.value)}
            style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
          />
          <div className="tokens">
            {TOKENS.map((token) => (
              <Button key={token} size="small" onClick={() => insert(token)}>
                {token.replace(/[{}]/g, '')}
              </Button>
            ))}
          </div>
          <div className="hint">示例：{sample}</div>
        </div>

        <div className="opts">
          <span>
            操作{' '}
            <Select
              size="small"
              value={action}
              onChange={setAction}
              style={{ width: 84 }}
              options={[
                { value: 'move', label: '移动' },
                { value: 'copy', label: '复制' }
              ]}
            />
          </span>
          <span>
            冲突{' '}
            <Select
              size="small"
              value={conflict}
              onChange={setConflict}
              style={{ width: 104 }}
              options={[
                { value: 'skip', label: '跳过' },
                { value: 'overwrite', label: '覆盖' },
                { value: 'rename', label: '自动重命名' }
              ]}
            />
          </span>
          <Checkbox checked={rmEmpty} onChange={(e) => setRmEmpty(e.target.checked)}>
            整理后删除空文件夹
          </Checkbox>
        </div>

        <div className="preview">
          <div className="preview-head">
            预览 <b>{done.length}</b> 个将整理 · <span>{skip.length}</span> 个跳过
          </div>
          <div className="preview-list">
            {done.map((row) => {
              const path = withExt(buildPath(tpl, row))
              return (
                <div className="pv" key={row.uid}>
                  <span className="from">{row.file}</span>
                  <span className="arw">→</span>
                  <span className="to">{path}</span>
                  <span className="tag move">{ACTION_LABEL[action]}</span>
                </div>
              )
            })}
            {skip.map((row) => (
              <div className="pv skip" key={row.uid}>
                <span className="from">{row.file}</span>
                <span className="arw">→</span>
                <span className="to">跳过（无法刮削）</span>
                <span className="tag skip">跳过</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
