import { spawn } from 'node:child_process'

const children = [
  spawn('bun', ['--watch', 'server/index.ts'], { stdio: 'inherit', shell: true }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: true })
]

const stop = () => {
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
