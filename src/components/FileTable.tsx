import { useEffect, useState } from 'react'
import { Button, Spin, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Key, MouseEvent as ReactMouseEvent, ThHTMLAttributes } from 'react'
import type { ModeConfig, Row, RowStatus } from '../types'
import { DEFAULT_COLUMN_WIDTHS } from '../tableColumns'
import { fmtDur, fmtSize } from '../utils'

const POSTER_BG = [
  'linear-gradient(150deg,#4a5570,#232a38)',
  'linear-gradient(150deg,#5b4a52,#2c2229)',
  'linear-gradient(150deg,#3f5a55,#1e2b28)'
]

/** 状态颜色走 CSS 变量，浅色 / 深色主题各自提供可读色值。 */
const STATUS: Record<RowStatus, { label: string; color: string }> = {
  done: { label: '已完成', color: 'var(--green)' },
  unmatched: { label: '无法刮削', color: 'var(--amber)' },
  running: { label: '刮削中', color: 'var(--blue)' },
  waiting: { label: '等待', color: 'var(--muted)' },
  error: { label: '失败', color: 'var(--red)' },
  review: { label: '待选择', color: 'var(--purple)' }
}

const MIN_COLUMN_WIDTH = 40
const MAX_COLUMN_WIDTH = 1200

const clampWidth = (value: number) =>
  Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(value)))

interface ResizeHeaderProps extends ThHTMLAttributes<HTMLTableCellElement> {
  onResize?: (event: ReactMouseEvent) => void
  onResetWidth?: () => void
}

/** 自定义表头：右侧细条拖动改列宽，双击恢复默认。 */
function ResizableTitle({ onResize, onResetWidth, children, ...rest }: ResizeHeaderProps) {
  return (
    <th {...rest}>
      {children}
      {onResize ? (
        <span
          className="col-resize"
          title="拖动调整列宽，双击恢复默认"
          onMouseDown={onResize}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onResetWidth?.()
          }}
        />
      ) : null}
    </th>
  )
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
  /** 已持久化的列宽；缺省列使用 DEFAULT_COLUMN_WIDTHS。 */
  columnWidths: Record<string, number>
  onColumnWidthsChange: (widths: Record<string, number>) => void
  /** 被隐藏的数据列 key；操作 / 选择列不受影响。 */
  hiddenColumns: string[]
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
  columnWidths,
  onColumnWidthsChange,
  hiddenColumns,
  onSelectedChange,
  onPoster,
  onRemove,
  onMatch,
  onReview,
  onContext
}: Props) {
  const shortLimit = minDur * 60
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>(() => ({
    ...columnWidths
  }))

  useEffect(() => {
    setLiveWidths({ ...columnWidths })
  }, [columnWidths])

  const widthOf = (key: string) =>
    clampWidth(liveWidths[key] ?? DEFAULT_COLUMN_WIDTHS[key] ?? 100)

  /** 拖动期间只更新本地状态，松开鼠标后再写入设置，避免每帧触发持久化。 */
  const startResize = (key: string) => (event: ReactMouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = widthOf(key)
    let latest = { ...liveWidths }

    const onMove = (move: MouseEvent) => {
      latest = { ...latest, [key]: clampWidth(startWidth + move.clientX - startX) }
      setLiveWidths(latest)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      onColumnWidthsChange(latest)
    }

    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const resetWidth = (key: string) => {
    const next = { ...liveWidths, [key]: DEFAULT_COLUMN_WIDTHS[key] ?? 100 }
    setLiveWidths(next)
    onColumnWidthsChange(next)
  }

  const headerCellProps = (key: string) =>
    ({
      onResize: startResize(key),
      onResetWidth: () => resetWidth(key)
    }) as unknown as ThHTMLAttributes<HTMLTableCellElement>

  const resizable = (key: string) => ({
    onHeaderCell: () => headerCellProps(key)
  })

  const muted = { fontSize: 11, color: 'var(--muted)' }

  const allColumns: ColumnsType<Row> = [
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: widthOf('status'),
      ...resizable('status'),
      render: (status: RowStatus) => (
        <span className="st" style={{ color: STATUS[status].color }}>
          <i style={{ background: STATUS[status].color }} />
          {STATUS[status].label}
        </span>
      )
    },
    {
      title: '海报',
      key: 'poster',
      width: widthOf('poster'),
      ...resizable('poster'),
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
      key: 'code',
      width: widthOf('code'),
      ...resizable('code'),
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
      title: '文件名',
      dataIndex: 'file',
      key: 'file',
      width: widthOf('file'),
      ...resizable('file'),
      ellipsis: true,
      render: (file: string, row) => (
        <span style={muted} title={row.path || file}>
          {file}
        </span>
      )
    },
    {
      title: mode.titleLabel,
      dataIndex: 'title',
      key: 'title',
      width: widthOf('title'),
      ...resizable('title'),
      ellipsis: true,
      render: (title: string, row) => (
        <span style={{ fontSize: 11.5 }} title={row.path || row.file}>
          {title}
        </span>
      )
    },
    {
      title: '片商',
      dataIndex: 'maker',
      key: 'maker',
      width: widthOf('maker'),
      ...resizable('maker'),
      ellipsis: true,
      render: (maker?: string) => <span style={muted}>{maker || '—'}</span>
    },
    {
      title: '演员',
      dataIndex: 'actors',
      key: 'actors',
      width: widthOf('actors'),
      ...resizable('actors'),
      ellipsis: true,
      render: (actors?: string) => <span style={muted}>{actors || '—'}</span>
    },
    {
      title: '时长',
      dataIndex: 'dur',
      key: 'dur',
      width: widthOf('dur'),
      ...resizable('dur'),
      sorter: (a, b) => a.dur - b.dur,
      render: (dur: number) => (
        <span
          className="dur"
          style={{ color: dur > 0 && dur < shortLimit ? 'var(--amber)' : undefined }}
        >
          {fmtDur(dur)}
          {dur > 0 && dur < shortLimit && (
            <span
              className="tag"
              style={{
                marginLeft: 5,
                color: 'var(--amber)',
                background: 'var(--amber-bg)',
                border: '1px solid var(--amber-border)'
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
      key: 'size',
      width: widthOf('size'),
      ...resizable('size'),
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
      key: 'src',
      width: widthOf('src'),
      ...resizable('src'),
      render: (src: string) => <span style={muted}>{src || '—'}</span>
    },
    {
      title: '进度',
      dataIndex: 'progress',
      key: 'progress',
      width: widthOf('progress'),
      ...resizable('progress'),
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
      title: '操作',
      key: 'act',
      width: widthOf('act'),
      ...resizable('act'),
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

  // 只过滤数据列；rowSelection 与「操作」列始终保留。
  const hidden = new Set(hiddenColumns)
  const columns = allColumns.filter((column) => !hidden.has(String(column.key)))

  const totalWidth =
    columns.reduce((sum, column) => sum + Number(column.width ?? 0), 0) + 34

  return (
    <div className={`tablewrap ${compact ? 'compact' : ''}`}>
      <Table<Row>
        size="small"
        rowKey="uid"
        columns={columns}
        components={{ header: { cell: ResizableTitle } }}
        dataSource={rows}
        pagination={false}
        scroll={{ y: Math.max(120, height - 39), x: totalWidth }}
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
