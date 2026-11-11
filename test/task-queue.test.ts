import { describe, expect, test } from 'bun:test'
import { TaskQueue, type TaskQueueProgress } from '../src/taskQueue'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function abortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  message = '等待超时'
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message)
    await sleep(2)
  }
}

describe('并发控制', () => {
  test('并发数上限生效且全部任务完成', async () => {
    let active = 0
    let maxActive = 0
    const started: number[] = []
    const queue = new TaskQueue<number, number>(
      [0, 1, 2, 3, 4, 5],
      async (task) => {
        started.push(task)
        active += 1
        maxActive = Math.max(maxActive, active)
        await sleep(8)
        active -= 1
        return task
      },
      { concurrency: 2 }
    )

    const final = await queue.start()

    expect(maxActive).toBe(2)
    expect(started).toHaveLength(6)
    expect(final.state).toBe('done')
    expect(final.done).toBe(6)
    expect(final.failed).toBe(0)
    expect(final.running).toBe(0)
  })
})

describe('暂停与继续', () => {
  test('pause 后不再派发，resume 继续剩余任务', async () => {
    const gates = Array.from({ length: 3 }, () => {
      let release!: () => void
      const promise = new Promise<void>((resolve) => {
        release = resolve
      })
      return { promise, release }
    })
    let started = 0
    const queue = new TaskQueue<number, number>(
      [0, 1, 2],
      async (task) => {
        started += 1
        await gates[task].promise
        return task
      },
      { concurrency: 1 }
    )

    const completion = queue.start()
    await waitFor(() => started === 1, 1000, '首个任务未启动')
    queue.pause()
    expect(queue.progress().state).toBe('paused')

    gates[0].release()
    await waitFor(
      () => queue.progress().done === 1 && queue.progress().running === 0,
      1000,
      '在途任务未跑完'
    )
    // pause 只停止派发，已在执行的任务仍需跑完。
    expect(started).toBe(1)
    expect(queue.progress().state).toBe('paused')

    queue.resume()
    expect(queue.progress().state).toBe('running')
    await waitFor(() => started === 2, 1000, 'resume 后未继续派发')
    gates[1].release()
    gates[2].release()

    const final = await completion
    expect(started).toBe(3)
    expect(final.state).toBe('done')
    expect(final.done).toBe(3)
  })

  test('重复 pause/resume 幂等，不影响最终结果', async () => {
    const queue = new TaskQueue<number, number>([0, 1], async (task) => task, {
      concurrency: 1
    })
    queue.pause()
    queue.resume()
    expect(queue.progress().state).toBe('idle')

    const completion = queue.start()
    queue.pause()
    queue.pause()
    queue.resume()
    queue.resume()
    const final = await completion
    expect(final.state).toBe('done')
    expect(final.done).toBe(2)
  })
})

describe('取消', () => {
  test('中断在途任务、保留已完成结果且不再派发剩余任务', async () => {
    const started: number[] = []
    const results: number[] = []
    let aborted = false
    const queue = new TaskQueue<number, number>(
      [0, 1, 2],
      async (task, signal) => {
        started.push(task)
        if (task === 1) {
          return new Promise<number>((_, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true
                reject(abortError())
              },
              { once: true }
            )
          })
        }
        return task
      },
      {
        concurrency: 1,
        onTaskDone: (task) => results.push(task)
      }
    )

    const completion = queue.start()
    // 任务 0 已完成，任务 1 正在等待 abort。
    await waitFor(
      () => queue.progress().done === 1 && queue.progress().running === 1,
      1000,
      '任务 1 未进入执行'
    )
    queue.cancel()
    const final = await completion

    expect(aborted).toBe(true)
    expect(final.state).toBe('cancelled')
    expect(final.done).toBe(1)
    expect(final.failed).toBe(0)
    expect(final.running).toBe(0)
    expect(results).toEqual([0])
    await sleep(10)
    expect(started).toEqual([0, 1])
  })

  test('pause 后取消：不派发新任务，在途任务收到 abort', async () => {
    let started = 0
    let aborted = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const queue = new TaskQueue<number, number>(
      [0, 1, 2],
      async (_task, signal) => {
        started += 1
        await Promise.race([
          gate,
          new Promise<never>((_, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true
                reject(abortError())
              },
              { once: true }
            )
          })
        ])
        return 0
      },
      { concurrency: 1 }
    )

    const completion = queue.start()
    await waitFor(() => started === 1 && queue.progress().running === 1)
    queue.pause()
    queue.cancel()
    release()
    const final = await completion

    expect(aborted).toBe(true)
    expect(final.state).toBe('cancelled')
    expect(final.running).toBe(0)
    expect(final.done).toBe(0)
    expect(started).toBe(1)
  })

  test('并发在途任务在 cancel 时全部收到 abort，最终进度只报告一次取消态', async () => {
    const signals: AbortSignal[] = []
    const progressLog: TaskQueueProgress[] = []
    const queue = new TaskQueue<number, number>(
      [0, 1, 2],
      async (task, signal) => {
        signals.push(signal)
        return new Promise<number>((_, reject) => {
          signal.addEventListener('abort', () => reject(abortError()), { once: true })
        })
      },
      {
        concurrency: 2,
        onProgress: (progress) => progressLog.push(progress)
      }
    )

    const completion = queue.start()
    await waitFor(() => queue.progress().running === 2)
    queue.cancel()
    const final = await completion

    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(final.state).toBe('cancelled')
    expect(final.failed).toBe(0)
    const last = progressLog[progressLog.length - 1]
    expect(last.state).toBe('cancelled')
    expect(last.running).toBe(0)
  })

  test('start 前取消则不再执行任何任务，重复 cancel 幂等', async () => {
    let started = 0
    const queue = new TaskQueue<number, number>(
      [0, 1],
      async (task) => {
        started += 1
        return task
      },
      { concurrency: 1 }
    )
    queue.cancel()
    queue.cancel()
    expect(queue.progress().state).toBe('cancelled')

    const final = await queue.start()
    expect(final.state).toBe('cancelled')
    expect(final.done).toBe(0)
    expect(started).toBe(0)
  })
})

describe('失败隔离', () => {
  test('单个任务失败不终止队列，失败计数正确', async () => {
    const started: number[] = []
    const failedTasks: number[] = []
    const queue = new TaskQueue<number, number>(
      [0, 1, 2],
      async (task) => {
        started.push(task)
        if (task === 1) throw new Error('boom')
        return task
      },
      {
        concurrency: 1,
        onTaskError: (task) => failedTasks.push(task)
      }
    )

    const final = await queue.start()
    expect(started).toEqual([0, 1, 2])
    expect(failedTasks).toEqual([1])
    expect(final.state).toBe('done')
    expect(final.done).toBe(2)
    expect(final.failed).toBe(1)
  })

  test('isFailure 把正常返回的失败结果计入 failed', async () => {
    const queue = new TaskQueue<{ ok: boolean }, { ok: boolean }>(
      [{ ok: true }, { ok: false }],
      async (task) => task,
      { concurrency: 1, isFailure: (result) => !result.ok }
    )
    const final = await queue.start()
    expect(final.state).toBe('done')
    expect(final.done).toBe(1)
    expect(final.failed).toBe(1)
  })
})

describe('空队列与重复调用', () => {
  test('空队列立即完成，重复 start 返回同一 Promise', async () => {
    const queue = new TaskQueue<number, number>([], async (task) => task)
    const first = queue.start()
    const second = queue.start()
    expect(second).toBe(first)

    const final: TaskQueueProgress = await first
    expect(final).toEqual({ total: 0, done: 0, failed: 0, running: 0, state: 'done' })
    queue.cancel()
    expect(queue.progress().state).toBe('done')
  })
})
