import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { native } from '../native'
import type {
  DuplicateGroup,
  LibraryItem,
  LibraryOrder,
  LibrarySort,
  LibraryStats,
  MediaSource,
  StatCount
} from '../types'
import { baseName, errText, fmtDur, fmtSize } from '../utils'

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

/** 保留建议：元数据最新优先，其次文件更大者，最后按路径稳定排序。 */
function recommendKeep(items: LibraryItem[]): LibraryItem {
  return [...items].sort(
    (a, b) =>
      (b.updatedAt ?? 0) - (a.updatedAt ?? 0) ||
      (b.size ?? 0) - (a.size ?? 0) ||
      a.path.localeCompare(b.path)
  )[0]
}

function StatList({ title, values }: { title: string; values: StatCount[] }) {
  return (
    <div>
      <div className="lib-section-title">{title}</div>
      {values.length === 0 ? (
        <div className="lib-hint">暂无数据</div>
      ) : (
        values.map((entry) => (
          <div className="lib-count-row" key={entry.name}>
            <span className="lib-file" title={entry.name}>
              {entry.name}
            </span>
            <span className="lib-mono">{entry.count}</span>
          </div>
        ))
      )}
    </div>
  )
}

function CountRows({ values }: { values: Record<string, number> }) {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (entries.length === 0) return <div className="lib-hint">暂无数据</div>
  return (
    <>
      {entries.map(([name, count]) => (
        <div className="lib-count-row" key={name || '(empty)'}>
          <span>{name || '未分配'}</span>
          <span className="lib-mono">{count}</span>
        </div>
      ))}
    </>
  )
}

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

  const { message, modal } = AntdApp.useApp()

  const [dupGroups, setDupGroups] = useState<DuplicateGroup[]>([])
  const [dupLoading, setDupLoading] = useState(false)
  const [dupError, setDupError] = useState('')
  const [dupRefresh, setDupRefresh] = useState(0)

  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [statsRefresh, setStatsRefresh] = useState(0)

  const [sources, setSources] = useState<MediaSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesError, setSourcesError] = useState('')
  const [sourcesRefresh, setSourcesRefresh] = useState(0)
  const [sourceBusy, setSourceBusy] = useState(false)

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

  useEffect(() => {
    if (!open || tab !== 'duplicates') return
    let cancelled = false
    setDupLoading(true)
    setDupError('')
    native
      .libraryDuplicates(modeFilter || undefined)
      .then((groups) => {
        if (!cancelled) setDupGroups(groups)
      })
      .catch((err) => {
        if (!cancelled) {
          setDupGroups([])
          setDupError(errText(err))
        }
      })
      .finally(() => {
        if (!cancelled) setDupLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, tab, modeFilter, dupRefresh])

  useEffect(() => {
    if (!open || tab !== 'stats') return
    let cancelled = false
    setStatsLoading(true)
    setStatsError('')
    native
      .libraryStats(modeFilter || undefined)
      .then((result) => {
        if (!cancelled) setStats(result)
      })
      .catch((err) => {
        if (!cancelled) {
          setStats(null)
          setStatsError(errText(err))
        }
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, tab, modeFilter, statsRefresh])

  useEffect(() => {
    if (!open || tab !== 'sources') return
    let cancelled = false
    setSourcesLoading(true)
    setSourcesError('')
    native
      .listSources()
      .then((list) => {
        if (!cancelled) setSources(list)
      })
      .catch((err) => {
        if (!cancelled) {
          setSources([])
          setSourcesError(errText(err))
        }
      })
      .finally(() => {
        if (!cancelled) setSourcesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, tab, sourcesRefresh])

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

  const addSource = async () => {
    setSourceBusy(true)
    try {
      const path = await native.pickFolder()
      if (!path) return
      const next = await native.addSource(path)
      setSources(next)
      message.success(`已添加来源：${baseName(path)}`)
    } catch (err) {
      message.error(`添加来源失败：${errText(err)}`)
    } finally {
      setSourceBusy(false)
    }
  }

  const removeSource = (source: MediaSource) => {
    modal.confirm({
      title: '删除来源记录',
      content: (
        <div style={{ fontSize: 11.5, lineHeight: 1.8 }}>
          将移除来源记录：<code>{source.path}</code>
          <br />
          <b>只删除记录，不会删除媒体库记录，也不会删除任何文件。</b>
        </div>
      ),
      okText: '删除来源',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const next = await native.removeSource(source.path)
          setSources(next)
          message.success('来源已删除')
        } catch (err) {
          message.error(`删除来源失败：${errText(err)}`)
          throw err
        }
      }
    })
  }

  const modeSelect = (
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
  )

  const listTab = (
    <div>
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
        {modeSelect}
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
  )

  const duplicatesTab = (
    <div>
      <div className="lib-filters">
        {modeSelect}
        <Button icon={<ReloadOutlined />} onClick={() => setDupRefresh((key) => key + 1)}>
          刷新
        </Button>
        <span className="lib-hint" style={{ margin: 0 }}>
          只做展示与保留建议，不会自动删除任何文件。
        </span>
      </div>
      {dupError ? (
        <Alert type="error" showIcon message="重复检测失败" description={dupError} />
      ) : dupLoading ? (
        <div className="lib-empty" style={{ textAlign: 'center' }}>
          <Spin />
        </div>
      ) : dupGroups.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未发现重复文件" />
      ) : (
        <div style={{ maxHeight: 500, overflow: 'auto' }}>
          {dupGroups.map((group) => {
            const keep = recommendKeep(group.items)
            return (
              <div className="lib-dup-group" key={`${group.reason}:${group.key}`}>
                <div className="lib-dup-head">
                  <Tag color={group.reason === 'code' ? 'blue' : 'orange'}>
                    {group.reason === 'code' ? '同番号' : '同大小 + 时长'}
                  </Tag>
                  <span className="lib-dup-key">{group.key}</span>
                  <span className="lib-hint" style={{ margin: 0 }}>
                    {group.items.length} 个文件 · 建议保留元数据最新/体积最大者
                  </span>
                </div>
                <div className="lib-dup-items">
                  {group.items.map((item) => (
                    <div
                      className={`lib-dup-item${item.path === keep.path ? ' keep' : ''}`}
                      key={item.path}
                    >
                      <span className="lib-dup-keep">
                        {item.path === keep.path ? '建议保留' : ''}
                      </span>
                      <Tooltip title={item.path}>
                        <span className="lib-dup-file">{item.file}</span>
                      </Tooltip>
                      <span className="lib-dup-meta">
                        {item.size ? fmtSize(item.size) : '—'}
                      </span>
                      <span className="lib-dup-meta">
                        {item.dur ? fmtDur(item.dur) : '—'}
                      </span>
                      <span className="lib-dup-meta">{formatTime(item.updatedAt)}</span>
                      <Button size="small" type="link" onClick={() => onOpenItem(item)}>
                        详情
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const statsTab = (
    <div>
      <div className="lib-filters">
        {modeSelect}
        <Button icon={<ReloadOutlined />} onClick={() => setStatsRefresh((key) => key + 1)}>
          刷新
        </Button>
      </div>
      {statsError ? (
        <Alert type="error" showIcon message="统计读取失败" description={statsError} />
      ) : statsLoading ? (
        <div className="lib-empty" style={{ textAlign: 'center' }}>
          <Spin />
        </div>
      ) : !stats || stats.total === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="媒体库暂无记录" />
      ) : (
        <>
          <div className="lib-stat-cards">
            <div className="lib-stat-card">
              <div className="label">总条目</div>
              <div className="value">{stats.total}</div>
            </div>
            <div className="lib-stat-card">
              <div className="label">总大小</div>
              <div className="value">{fmtSize(stats.totalSize)}</div>
            </div>
            <div className="lib-stat-card">
              <div className="label">模式数</div>
              <div className="value">{Object.keys(stats.byMode).length}</div>
            </div>
            <div className="lib-stat-card">
              <div className="label">状态数</div>
              <div className="value">{Object.keys(stats.byStatus).length}</div>
            </div>
          </div>
          <div className="lib-stat-grid">
            <div>
              <div className="lib-section-title">按模式</div>
              <CountRows values={stats.byMode} />
            </div>
            <div>
              <div className="lib-section-title">按状态</div>
              <CountRows values={stats.byStatus} />
            </div>
          </div>
          <div className="lib-section lib-stat-grid">
            <StatList title="Top 片商" values={stats.topMakers} />
            <StatList title="Top 演员" values={stats.topActors} />
          </div>
          <div className="lib-section">
            <StatList title="Top 标签" values={stats.topTags} />
          </div>
        </>
      )}
    </div>
  )

  const sourcesTab = (
    <div>
      <div className="lib-hint">
        来源只记录扫描根目录；扫描成功后会自动登记。删除来源
        <b>不会删除媒体库记录，也不会删除任何文件</b>。
      </div>
      <div className="lib-filters">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          loading={sourceBusy}
          onClick={() => void addSource()}
        >
          添加来源
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => setSourcesRefresh((key) => key + 1)}>
          刷新
        </Button>
        <span className="lib-hint" style={{ margin: 0 }}>
          共 {sources.length} 个来源
        </span>
      </div>
      {sourcesError ? (
        <Alert type="error" showIcon message="来源读取失败" description={sourcesError} />
      ) : sourcesLoading ? (
        <div className="lib-empty" style={{ textAlign: 'center' }}>
          <Spin />
        </div>
      ) : sources.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有登记任何来源" />
      ) : (
        sources.map((source) => (
          <div className="lib-source-row" key={source.path}>
            <div className="lib-source-main">
              <div className="lib-source-name">{source.name || baseName(source.path)}</div>
              <div className="lib-source-path" title={source.path}>
                {source.path}
              </div>
              <div className="lib-hint" style={{ margin: '2px 0 0' }}>
                添加于 {formatTime(source.addedAt)}
              </div>
            </div>
            <Button
              danger
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => removeSource(source)}
            >
              删除
            </Button>
          </div>
        ))
      )}
    </div>
  )

  return (
    <Modal
      open={open}
      title="媒体库"
      width={1180}
      footer={null}
      onCancel={onClose}
      styles={{ body: { paddingTop: 8 } }}
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'list', label: '列表', children: listTab },
          {
            key: 'duplicates',
            label: `重复${dupGroups.length ? ` (${dupGroups.length})` : ''}`,
            children: duplicatesTab
          },
          { key: 'stats', label: '统计', children: statsTab },
          {
            key: 'sources',
            label: `来源${sources.length ? ` (${sources.length})` : ''}`,
            children: sourcesTab
          }
        ]}
      />
    </Modal>
  )
}
