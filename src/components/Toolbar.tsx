import { Button } from 'antd'
import {
  FolderOpenOutlined,
  FolderOutlined,
  FolderAddOutlined,
  PlayCircleOutlined,
  RobotOutlined
} from '@ant-design/icons'

interface Props {
  path: string
  busy?: boolean
  onPick: () => void
  onOrganize: () => void
  onStart: () => void
  onAI: () => void
}

export default function Toolbar({ path, busy = false, onPick, onOrganize, onStart, onAI }: Props) {
  return (
    <div className="toolbar">
      <div className="pathbox" title={path || '未选择目录'}>
        <FolderOutlined />
        <span className={path ? undefined : 'muted'}>{path || '未选择目录'}</span>
      </div>
      <Button icon={<FolderOpenOutlined />} onClick={onPick} disabled={busy}>
        选择文件夹
      </Button>
      <Button icon={<RobotOutlined />} onClick={onAI}>
        AI
      </Button>
      <Button icon={<FolderAddOutlined />} onClick={onOrganize} disabled={!path || busy}>
        整理
      </Button>
      <Button
        type="primary"
        icon={<PlayCircleOutlined />}
        onClick={onStart}
        disabled={!path || busy}
      >
        开始刮削
      </Button>
    </div>
  )
}
