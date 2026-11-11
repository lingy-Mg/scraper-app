import { Button, InputNumber, Switch } from 'antd'
import type { FilterKey } from '../types'

const TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待刮削' },
  { key: 'review', label: '待选择' },
  { key: 'done', label: '已完成' },
  { key: 'unmatched', label: '无法刮削' }
]

interface Props {
  filter: FilterKey
  counts: Record<FilterKey, number>
  minDur: number
  hideShorts: boolean
  hiddenShortCount: number
  onFilter: (key: FilterKey) => void
  onMinDur: (value: number) => void
  onHideShorts: (value: boolean) => void
  onClearLibrary: () => void
  onReimport: () => void
  onClean: () => void
  blacklistCount: number
  onBlacklist: () => void
}

export default function FilterBar({
  filter,
  counts,
  minDur,
  hideShorts,
  hiddenShortCount,
  onFilter,
  onMinDur,
  onHideShorts,
  onClearLibrary,
  onReimport,
  onClean,
  blacklistCount,
  onBlacklist
}: Props) {
  return (
    <div className="filterbar">
      <div className="ftabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`ftab ${filter === t.key ? 'on' : ''}`}
            onClick={() => onFilter(t.key)}
          >
            {t.label}
            <span className="n">{counts[t.key]}</span>
          </button>
        ))}
      </div>
      <div className="clean">
        <span className="hide-shorts" title="时长为 0 的文件不会被判定为短片">
          <Switch size="small" checked={hideShorts} onChange={onHideShorts} />
          隐藏短片
          {hideShorts && hiddenShortCount > 0 && (
            <span className="muted">（{hiddenShortCount}）</span>
          )}
        </span>
        <span>清理时长 &lt;</span>
        <InputNumber
          size="small"
          min={1}
          value={minDur}
          style={{ width: 52 }}
          onChange={(v) => onMinDur(v || 10)}
        />
        <span>分钟</span>
        <Button size="small" danger onClick={onClean}>
          清理
        </Button>
        <Button
          size="small"
          onClick={onBlacklist}
          title="按文件名屏蔽 BT 附带文件；只隐藏，不删除"
        >
          黑名单{blacklistCount > 0 ? `（${blacklistCount}）` : ''}
        </Button>
        <Button size="small" onClick={onClearLibrary} title="清空媒体库列表（不会删除文件）">
          清空列表
        </Button>
        <Button
          size="small"
          onClick={onReimport}
          title="清空媒体库并重新扫描当前文件夹（不会删除文件）"
        >
          重新导入
        </Button>
      </div>
    </div>
  )
}
