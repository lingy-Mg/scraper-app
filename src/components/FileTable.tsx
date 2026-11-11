import { Button, Spin, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Key } from 'react'
import type { ModeConfig, Row, RowStatus } from '../types'
import { fmtDur, fmtSize } from '../utils'

const POSTER_BG = [
  'linear-gradient(150deg,#4a5570,#232a38)',
  'linear-gradient(150deg,#5b4a52,#2c2229)',
  'linear-gradient(150deg,#3f5a55,#1e2b28)'
]

const STATUS: Record<RowStatus, { label: string; color: string }> = {
  done: { label: '已完成', color: '#188a4c' },
  unmatched: { label: '无法刮削', color: '#b45309' },
  running: { label: '刮削中', color: '#1f6feb' },
  waiting: { label: '等待', color: '#6b7280' },
  error: { label: '失败', color: '#c0392b' },
  review: { label: '待选择', color: '#7c3aed' }
}

interface Props {
  rows: Row[]
  mode: ModeConfig
  minDur: number
  selected: Key[]
  height: number
  compact: boolean
  scanning?: boolean
  scanFound?: number
  onSelectedChange: (keys: Key[]) => void
  onPoster: (row: Row) => void
  onRemove: (row: Row) => void
  onMatch: (row: Row) => void
  onReview: (row: Row) => void
  onContext: (e: React.MouseEvent, row: Row) => void
}

export default function FileTable({
  rows,
  mode,
  minDur,
  selected,
  height,
  compact,
  scanning = false,
  scanFound = 0,
  onSelectedChange,
  onPoster,
  onRemove,
  onMatch,
  onReview,
  onContext
}: Props) {
  const shortLimit = minDur * 60

  const columns: ColumnsType<Row> = [
    {
      title: '状态',
      dataIndex: 'status',
      width: 88,
      render: (status: RowStatus) => (
        <span className="st" style={{ color: STATUS[status].color }}>
          <i style={{ background: STATUS[status].color }} />
          {STATUS[status].label}
        </span>
      )
    },
    {
      title: '',
      key: 'poster',
      width: 46,
      render: (_, row) => (
        <div className="poster" onClick={() => onPoster(row)} title="预览海报">
          {row.posterSrc ? (
            <img src={row.posterSrc} alt="" />
          ) : (
            <span
              className="poster-ph"
              style={{ background: POSTER_BG[row.poster % POSTER_BG.length] }}
            />
          )}
        </div>
      )
    },
    {
      title: mode.codeLabel,
      dataIndex: 'code',
      width: 118,
      sorter: (a, b) => (a.code || '~').localeCompare(b.code || '~'),
      render: (code: string, row) =>
        code ? (
          <span className="code">
            {code}
            {row.ai && (
              <Tooltip title={`AI 识别 · ${Math.round((row.aiConfidence || 0.98) * 100)}%`}>
                <span className="ai-tag">AI</span>
              </Tooltip>
            )}
          </span>
        ) : (
          <span className="muted">—</span>
        )
    },
    {
      title: mode.titleLabel,
      dataIndex: 'title',
      ellipsis: true,
      render: (title: string, row) => (
        <span style={{ fontSize: 11.5 }} title={row.path || row.file}>
          {title}
        </span>
      )
    },
    {
      title: '时长',
      dataIndex: 'dur',
      width: 116,
      sorter: (a, b) => a.dur - b.dur,
      render: (dur: number) => (
        <span className="dur" style={{ color: dur > 0 && dur < shortLimit ? 'var(--amber)' : undefined }}>
          {fmtDur(dur)}
          {dur > 0 && dur < shortLimit && (
            <span
              className="tag"
              style={{
                marginLeft: 5,
                color: 'var(--amber)',
                background: '#fdf6ec',
                border: '1px solid #f0dcc0'
              }}
            >
              短片
            </span>
          )}
        </span>
      )
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 94,
      sorter: (a, b) => a.size - b.size,
      render: (size: number) => (
        <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          {fmtSize(size)}
        </span>
      )
    },
    {
      title: '来源',
      dataIndex: 'src',
      width: 66,
      render: (src: string) => (
        <span className="muted" style={{ fontSize: 11 }}>
          {src || '—'}
        </span>
      )
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 104,
      render: (_, row) => {
        if (row.status === 'unmatched') return <span className="muted">—</span>
        const percent = row.status === 'done' ? 100 : row.progress
        return (
          <div className="progress">
            <div className="bar">
              <i
                style={{
                  width: `${percent}%`,
                  background: row.status === 'done' ? 'var(--green)' : undefined
                }}
              />
            </div>
            <span>{percent}%</span>
          </div>
        )
      }
    },
    {
      title: '',
      key: 'act',
      width: 88,
      align: 'right',
      render: (_, row) =>
        row.status === 'done' ? (
          <Button type="link" size="small" danger onClick={() => onRemove(row)}>
            移除
          </Button>
        ) : row.status === 'unmatched' ? (
          <Button type="link" size="small" onClick={() => onMatch(row)}>
            识别
          </Button>
        ) : row.status === 'review' ? (
          <Button type="link" size="small" onClick={() => onReview(row)}>
            选择 ({row.candidates?.length || 0})
          </Button>
        ) : (
          <Button type="link" size="small" danger onClick={() => onRemove(row)}>
            取消
          </Button>
        )
    }
  ]

  return (
    <div className={`tablewrap ${compact ? 'compact' : ''}`}>
      <Table<Row>
        size="small"
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ y: Math.max(120, height - 39), x: 1060 }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: onSelectedChange,
          columnWidth: 34
        }}
        onRow={(row) => ({
          onContextMenu: (e) => {
            e.preventDefault()
            onContext(e, row)
          }
        })}
        showSorterTooltip={false}
        locale={{
          emptyText: scanning ? (
            <div className="scan-empty">
              <Spin size="small" />
              <span>
                正在扫描…{scanFound > 0 ? ` 已发现 ${scanFound} 个视频` : ''}
              </span>
            </div>
          ) : (
            '没有文件'
          )
        }}
      />
    </div>
  )
}
