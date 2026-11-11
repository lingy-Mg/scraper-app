import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Spin } from 'antd'
import {
  ArrowUpOutlined,
  FolderOutlined,
  HddOutlined,
  HomeOutlined
} from '@ant-design/icons'
import { native } from '../native'
import type { FsEntry, FsRoot } from '../types'

interface Props {
  open: boolean
  /** 打开时优先定位到的目录（不存在时回退到第一个根位置）。 */
  initialPath?: string
  onSelect: (path: string) => void
  onCancel: () => void
}

interface Crumb {
  name: string
  path: string
}

const errText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** 把绝对路径拆成面包屑；Windows 盘符独立成一级。 */
function buildCrumbs(path: string): Crumb[] {
  if (!path) return []
  const windows = /^[A-Za-z]:[\\/]/.test(path)
  const pieces = path.split(/[\\/]+/).filter(Boolean)

  if (windows) {
    const drive = pieces.shift() ?? ''
    if (!drive) return []
    const crumbs: Crumb[] = [{ name: `${drive}\\`, path: `${drive}\\` }]
    let acc = `${drive}\\`
    for (const piece of pieces) {
      acc = acc.endsWith('\\') ? `${acc}${piece}` : `${acc}\\${piece}`
      crumbs.push({ name: piece, path: acc })
    }
    return crumbs
  }

  const crumbs: Crumb[] = [{ name: '/', path: '/' }]
  let acc = ''
  for (const piece of pieces) {
    acc = `${acc}/${piece}`
    crumbs.push({ name: piece, path: acc })
  }
  return crumbs
}

function RootIcon({ kind }: { kind: FsRoot['kind'] }) {
  if (kind === 'drive') return <HddOutlined />
  if (kind === 'home') return <HomeOutlined />
  return <FolderOutlined />
}

export default function FolderPickerModal({
  open,
  initialPath,
  onSelect,
  onCancel
}: Props) {
  const [roots, setRoots] = useState<FsRoot[]>([])
  const [current, setCurrent] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const browse = async (path: string, fallback?: string): Promise<boolean> => {
    setLoading(true)
    setError('')
    setSelected(null)
    try {
      const data = await native.fsList(path)
      setCurrent(data.path)
      setParent(data.parent)
      setEntries(data.entries)
      setInput(data.path)
      setLoading(false)
      return true
    } catch (err) {
      if (fallback && fallback !== path) {
        setLoading(false)
        return browse(fallback)
      }
      setLoading(false)
      setEntries([])
      setError(errText(err))
      return false
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setRoots([])
    setCurrent('')
    setParent(null)
    setEntries([])
    setSelected(null)
    setInput('')
    setError('')
    setLoading(true)

    void (async () => {
      try {
        const list = await native.fsRoots()
        if (cancelled) return
        setRoots(list)
        const start = initialPath?.trim() || list[0]?.path || ''
        if (start) await browse(start, list[0]?.path)
        else {
          setLoading(false)
          setError('没有可浏览的位置')
        }
      } catch (err) {
        if (!cancelled) {
          setLoading(false)
          setError(`无法读取磁盘列表：${errText(err)}`)
        }
      }
    })()

    return () => {
      cancelled = true
    }
    // 只在打开或初始路径变化时重新加载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPath])

  const crumbs = useMemo(() => buildCrumbs(current), [current])
  const target = selected ?? current

  const jump = () => {
    const value = input.trim()
    if (value) void browse(value)
  }

  return (
    <Modal
      open={open}
      title="选择扫描目录"
      width={780}
      footer={null}
      maskClosable={false}
      onCancel={onCancel}
      destroyOnClose
    >
      <div className="fpm">
        <div className="fpm-path">
          <Button
            icon={<ArrowUpOutlined />}
            disabled={!parent || loading}
            onClick={() => parent && void browse(parent)}
          >
            上一级
          </Button>
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPressEnter={jump}
            placeholder="输入绝对路径后按回车，例如 C:\Users\Public\Videos"
            spellCheck={false}
          />
          <Button onClick={jump} disabled={loading || !input.trim()}>
            跳转
          </Button>
        </div>

        <div className="fpm-crumbs">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.path}-${index}`} className="fpm-crumb-wrap">
              {index > 0 && <span className="fpm-crumb-sep">/</span>}
              <button
                type="button"
                className="fpm-crumb"
                onClick={() => void browse(crumb.path)}
                disabled={loading}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        <div className="fpm-body">
          <div className="fpm-roots">
            <div className="fpm-section-title">位置</div>
            {roots.map((root) => (
              <button
                type="button"
                key={`${root.kind}-${root.path}`}
                className={`fpm-root${current === root.path ? ' active' : ''}`}
                onClick={() => void browse(root.path)}
                disabled={loading}
                title={root.path}
              >
                <RootIcon kind={root.kind} />
                <span className="fpm-root-name">{root.name}</span>
              </button>
            ))}
          </div>

          <div className="fpm-list">
            {loading ? (
              <div className="fpm-state">
                <Spin size="small" />
                <span>正在读取目录…</span>
              </div>
            ) : error ? (
              <Alert
                type="error"
                showIcon
                message="无法打开目录"
                description={error}
              />
            ) : entries.length === 0 ? (
              <Empty description="此目录没有子文件夹" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              entries.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  className={`fpm-entry${selected === entry.path ? ' selected' : ''}${
                    entry.hidden ? ' hidden' : ''
                  }`}
                  onClick={() => setSelected(entry.path)}
                  onDoubleClick={() => void browse(entry.path)}
                  title={entry.hidden ? `${entry.name}（隐藏目录）` : entry.name}
                >
                  <FolderOutlined />
                  <span className="fpm-entry-name">{entry.name}</span>
                  {entry.hidden && <span className="fpm-hidden-tag">隐藏</span>}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="fpm-footer">
          <span className="fpm-target" title={target}>
            将扫描：<code>{target || '未选择目录'}</code>
          </span>
          <div className="fpm-actions">
            <Button onClick={onCancel}>取消</Button>
            <Button
              type="primary"
              disabled={!target || loading || Boolean(error)}
              onClick={() => target && onSelect(target)}
            >
              选择此文件夹
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
