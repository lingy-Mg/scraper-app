import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { native } from '../native'
import type { LibraryItem, LibraryOrder, LibrarySort } from '../types'
import { errText, fmtDur, fmtSize } from '../utils'

interface Props {
  open: boolean
  onClose: () => void
  onOpenItem: (item: LibraryItem) => void
}

const STATUS_LABEL: Record<string, string> = {
  done: '已完成',
  unmatched: '未匹配',
  review: '待确认',
  error: '错误',
  running: '进行中',
  waiting: '等待中'
}

const STATUS_COLOR: Record<string, string> = {
  done: 'green',
  unmatched: 'default',
  review: 'orange',
  error: 'red',
  running: 'blue',
  waiting: 'default'
}

const MODE_OPTIONS = [
  { value: 'av', label: 'AV' },
  { value: 'movie', label: '电影' },
  { value: 'tv', label: '电视剧' },
  { value: 'anime', label: '动漫' }
]

const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))

const SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: 'updatedAt', label: '更新时间' },
  { value: 'title', label: '标题' },
  { value: 'size', label: '大小' },
  { value: 'dur', label: '时长' },
  { value: 'year', label: '年份' }
]

interface Filters {
  q: string
  maker: string
  actor: string
  tag: string
  status: string
}

const EMPTY_FILTERS: Filters = { q: '', maker: '', actor: '', tag: '', status: '' }

const formatTime = (value?: number) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'

const columns: ColumnsType<LibraryItem> = [
  {
    title: '文件',
    dataIndex: 'file',
    key: 'file',
    ellipsis: true,
    render: (_, item) => (
      <Tooltip title={item.path}>
        <span className="lib-file">{item.file}</span>
      </Tooltip>
    )
  },
  {
    title: '番号',
    dataIndex: 'code',
    key: 'code',
    width: 110,
    render: (value: string) => (value ? <span className="lib-mono">{value}</span> : '—')
  },
  { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true },
  {
    title: '模式',
    dataIndex: 'mode',
    key: 'mode',
    width: 78,
    render: (value: string) => value || '—'
  },
  {
    title: '片商',
    dataIndex: 'maker',
    key: 'maker',
    width: 110,
    ellipsis: true,
    render: (value?: string) => value || '—'
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 86,
    render: (value: string) => (
      <Tag color={STATUS_COLOR[value] ?? 'default'}>{STATUS_LABEL[value] ?? (value || '—')}</Tag>
    )
  },
  {
    title: '时长',
    dataIndex: 'dur',
    key: 'dur',
    width: 84,
    render: (value?: number) => (value && value > 0 ? fmtDur(value) : '—')
  },
  {
    title: '大小',
    dataIndex: 'size',
    key: 'size',
    width: 92,
    render: (value?: number) => (value && value > 0 ? fmtSize(value) : '—')
  },
  {
    title: '更新',
    dataIndex: 'updatedAt',
    key: 'updatedAt',
    width: 154,
    render: (value?: number) => formatTime(value)
  }
]

export default function LibraryModal({ open, onClose, onOpenItem }: Props) {
  const [tab, setTab] = useState('list')
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [modeFilter, setModeFilter] = useState('')
  const [sort, setSort] = useState<LibrarySort>('updatedAt')
  const [order, setOrder] = useState<LibraryOrder>('desc')
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [refreshKey, setRefreshKey] = useState(0)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    if (!open || tab !== 'list') return
    const id = ++seq.current
    setLoading(true)
    setError('')
    native
      .libraryQuery({
        q: filters.q,
        mode: modeFilter,
        maker: filters.maker,
        actor: filters.actor,
        tag: filters.tag,
        status: filters.status,
        sort,
        order,
        limit,
        offset: (page - 1) * limit
      })
      .then((result) => {
        if (id !== seq.current) return
        setItems(result.items)
        setTotal(result.total)
      })
      .catch((err) => {
        if (id !== seq.current) return
        setItems([])
        setTotal(0)
        setError(errText(err))
      })
      .finally(() => {
        if (id === seq.current) setLoading(false)
      })
  }, [open, tab, filters, modeFilter, sort, order, page, limit, refreshKey])

  const applyFilters = () => {
    setFilters({ ...draft })
    setPage(1)
  }

  const resetFilters = () => {
    setDraft(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setModeFilter('')
    setPage(1)
  }

  return (
    <Modal
      open={open}
      title="媒体库"
      width={1180}
      footer={null}
      onCancel={onClose}
      styles={{ body: { paddingTop: 8 } }}
    >
      <div className="lib-tabs">
        <div className="lib-tabbar">
          <Button size="small" type={tab === 'list' ? 'primary' : 'text'} onClick={() => setTab('list')}>
            列表
          </Button>
        </div>

        <div className="lib-filters">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索标题 / 番号 / 文件名 / 演员 / 片商 / 系列"
            value={draft.q}
            onChange={(event) => setDraft((prev) => ({ ...prev, q: event.target.value }))}
            onPressEnter={applyFilters}
            style={{ width: 290 }}
          />
          <Select
            allowClear
            placeholder="全部模式"
            value={modeFilter || undefined}
            options={MODE_OPTIONS}
            onChange={(value) => {
              setModeFilter(value ?? '')
              setPage(1)
            }}
            style={{ width: 120 }}
          />
          <Input
            allowClear
            placeholder="片商"
            value={draft.maker}
            onChange={(event) => setDraft((prev) => ({ ...prev, maker: event.target.value }))}
            onPressEnter={applyFilters}
            style={{ width: 120 }}
          />
          <Input
            allowClear
            placeholder="演员"
            value={draft.actor}
            onChange={(event) => setDraft((prev) => ({ ...prev, actor: event.target.value }))}
            onPressEnter={applyFilters}
            style={{ width: 120 }}
          />
          <Input
            allowClear
            placeholder="标签"
            value={draft.tag}
            onChange={(event) => setDraft((prev) => ({ ...prev, tag: event.target.value }))}
            onPressEnter={applyFilters}
            style={{ width: 110 }}
          />
          <Select
            allowClear
            placeholder="全部状态"
            value={draft.status || undefined}
            options={STATUS_OPTIONS}
            onChange={(value) => setDraft((prev) => ({ ...prev, status: value ?? '' }))}
            style={{ width: 120 }}
          />
          <Select
            value={sort}
            options={SORT_OPTIONS}
            onChange={(value) => {
              setSort(value)
              setPage(1)
            }}
            style={{ width: 110 }}
          />
          <Select
            value={order}
            options={[
              { value: 'desc', label: '降序' },
              { value: 'asc', label: '升序' }
            ]}
            onChange={(value) => {
              setOrder(value)
              setPage(1)
            }}
            style={{ width: 86 }}
          />
          <Button type="primary" onClick={applyFilters}>
            查询
          </Button>
          <Button onClick={resetFilters}>重置</Button>
          <Button icon={<ReloadOutlined />} onClick={() => setRefreshKey((key) => key + 1)}>
            刷新
          </Button>
        </div>

        {error ? (
          <Alert
            type="error"
            showIcon
            message="媒体库查询失败"
            description={error}
            style={{ marginBottom: 8 }}
          />
        ) : null}

        <Table<LibraryItem>
          size="small"
          rowKey="path"
          columns={columns}
          dataSource={items}
          loading={loading}
          scroll={{ x: 980, y: 460 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={loading ? '正在加载…' : '没有匹配的媒体库记录'}
              />
            )
          }}
          pagination={{
            current: page,
            pageSize: limit,
            total,
            showSizeChanger: false,
            showTotal: (count) => `共 ${count} 条`,
            onChange: (next) => setPage(next)
          }}
          onRow={(item) => ({
            onClick: () => onOpenItem(item),
            style: { cursor: 'pointer' }
          })}
        />
      </div>
    </Modal>
  )
}
