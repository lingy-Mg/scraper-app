import { Menu } from 'antd'
import type { MenuProps } from 'antd'

const items: MenuProps['items'] = [
  {
    key: 'file',
    label: '文件',
    children: [
      { key: 'pick', label: '选择文件夹…' },
      { key: 'rescan', label: '重新扫描' },
      { type: 'divider' },
      { key: 'clean', label: '清理短片…' },
      { key: 'blacklist', label: '文件名黑名单…' },
      { key: 'organize', label: '整理文件…' },
      { key: 'config', label: '刮削配置…' },
      { key: 'ai', label: 'AI 识别设置…' },
      { key: 'reloadPlugins', label: '重载插件' },
      { type: 'divider' },
      { key: 'reimport', label: '重置并重新导入当前文件夹…' },
      { key: 'clearLibrary', label: '清空列表（不删除文件）…' },
      { key: 'quit', label: '退出' }
    ]
  },
  {
    key: 'edit',
    label: '编辑',
    children: [
      { key: 'selectAll', label: '全选' },
      { key: 'unselect', label: '取消选择' },
      { type: 'divider' },
      { key: 'delete', label: '删除所选' }
    ]
  },
  {
    key: 'view',
    label: '视图',
    children: [
      { key: 'log', label: '显示 / 隐藏日志' },
      { key: 'compact', label: '紧凑模式' }
    ]
  },
  {
    key: 'help',
    label: '帮助',
    children: [{ key: 'about', label: '关于刮削器' }]
  }
]

export default function MenuBar({ onAction }: { onAction: (key: string) => void }) {
  return (
    <div className="menubar">
      <Menu
        mode="horizontal"
        selectable={false}
        items={items}
        onClick={({ key }) => onAction(key)}
      />
    </div>
  )
}
