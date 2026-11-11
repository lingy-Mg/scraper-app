/**
 * 通用任务队列：可配置并发数，支持暂停、继续与取消。
 *
 * 语义（调用方必须可预期）：
 * - `pause()`：停止派发新任务，已在执行的任务继续跑完；
 * - `resume()`：恢复派发剩余任务；
 * - `cancel()`：停止派发，并对所有在途任务调用 `AbortController.abort()`；
 *   已完成的结果与回调不丢失，未开始的任务不再执行；
 * - 单个任务抛错只计入 `failed`，队列继续执行其它任务。
 *
 * 进度中的 `done` 只统计成功完成的任务；`failed` 统计抛错或经
 * `isFailure` 判定为失败的任务；被取消中断的任务既不算 done 也不算 failed。
 */
export type TaskQueueState = 'idle' | 'running' | 'paused' | 'cancelled' | 'done'

export interface TaskQueueProgress {
  total: number
  done: number
  failed: number
  /** 当前正在执行的任务数。 */
  running: number
  state: TaskQueueState
}

export interface TaskQueueOptions<T, R> {
  /** 并发上限，默认 3；小于 1 时按 1 处理。 */
  concurrency?: number
  /** 每次状态/计数变化时回调（同步调用）。 */
  onProgress?: (progress: TaskQueueProgress) => void
  /** 任务成功完成（含被 `isFailure` 判为失败的任务）时回调。 */
  onTaskDone?: (task: T, result: R) => void
  /** 任务抛错时回调；取消导致的中断不会触发。 */
  onTaskError?: (task: T, error: unknown) => void
  /**
   * 可选：把正常返回的结果归类为失败，例如接口返回 `{ ok: false }`。
   * 被归类的任务仍会触发 `onTaskDone`，便于调用方展示结果详情。
   */
  isFailure?: (result: R, task: T) => boolean
}

export class TaskQueue<T, R = unknown> {
  private readonly items: readonly T[]
  private readonly runTask: (task: T, signal: AbortSignal) => Promise<R> | R
  private readonly concurrency: number
  private readonly options: TaskQueueOptions<T, R>

  private state: TaskQueueState = 'idle'
  private nextIndex = 0
  private running = 0
  private done = 0
  private failed = 0
  private readonly controllers = new Map<number, AbortController>()
  private completion: Promise<TaskQueueProgress> | null = null
  private resolveCompletion: ((progress: TaskQueueProgress) => void) | null = null
  private completionResolved = false

  constructor(
    items: readonly T[],
    runTask: (task: T, signal: AbortSignal) => Promise<R> | R,
    options: TaskQueueOptions<T, R> = {}
  ) {
    this.items = [...items]
    this.runTask = runTask
    const limit = Math.floor(options.concurrency ?? 3)
    this.concurrency = Number.isFinite(limit) && limit > 0 ? limit : 1
    this.options = options
  }

  /** 当前状态快照。 */
  progress(): TaskQueueProgress {
    return {
      total: this.items.length,
      done: this.done,
      failed: this.failed,
      running: this.running,
      state: this.state
    }
  }

  /**
   * 启动队列。重复调用返回同一个 Promise；队列已取消/完成时返回当前快照。
   * 空队列会立即完成（state = done）。
   */
  start(): Promise<TaskQueueProgress> {
    if (this.completion) return this.completion
    if (this.state !== 'idle') return Promise.resolve(this.progress())

    this.completion = new Promise<TaskQueueProgress>((resolve) => {
      this.resolveCompletion = resolve
    })
    this.state = 'running'
    this.emit()
    this.pump()
    return this.completion
  }

  /** 暂停派发；在途任务跑完。非 running 状态调用无副作用。 */
  pause(): void {
    if (this.state !== 'running') return
    this.state = 'paused'
    this.emit()
  }

  /** 恢复派发；仅 paused 状态有效。 */
  resume(): void {
    if (this.state !== 'paused') return
    this.state = 'running'
    this.pump()
  }

  /**
   * 取消队列：停止派发并中断在途任务。
   * 已完成的结果保留；重复调用与 done 之后调用均无副作用。
   */
  cancel(): void {
    if (this.state === 'cancelled' || this.state === 'done') return
    this.state = 'cancelled'
    for (const controller of this.controllers.values()) controller.abort()
    this.emit()
    if (this.running === 0) this.settle()
  }

  private pump(): void {
    if (this.state === 'running') {
      while (this.running < this.concurrency && this.nextIndex < this.items.length) {
        this.dispatch(this.nextIndex)
        this.nextIndex += 1
      }
      if (this.running === 0 && this.nextIndex >= this.items.length) {
        this.state = 'done'
      }
    }
    this.emit()
    if (this.running === 0 && (this.state === 'done' || this.state === 'cancelled')) {
      this.settle()
    }
  }

  private dispatch(index: number): void {
    const task = this.items[index]
    const controller = new AbortController()
    this.controllers.set(index, controller)
    this.running += 1
    void this.execute(index, task, controller)
  }

  private async execute(index: number, task: T, controller: AbortController): Promise<void> {
    try {
      const result = await this.runTask(task, controller.signal)
      if (this.options.isFailure?.(result, task)) {
        this.failed += 1
      } else {
        this.done += 1
      }
      this.invoke(() => this.options.onTaskDone?.(task, result))
    } catch (error) {
      // 取消导致的中断是预期行为，不计入失败。
      const cancelled = controller.signal.aborted || this.isAbortError(error)
      if (!cancelled) {
        this.failed += 1
        this.invoke(() => this.options.onTaskError?.(task, error))
      }
    } finally {
      this.controllers.delete(index)
      this.running -= 1
      this.pump()
    }
  }

  private emit(): void {
    this.invoke(() => this.options.onProgress?.(this.progress()))
  }

  private settle(): void {
    if (this.completionResolved) return
    this.completionResolved = true
    this.resolveCompletion?.(this.progress())
    this.resolveCompletion = null
  }

  private isAbortError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError'
    )
  }

  /** 回调异常不能影响队列自身的调度与计数。 */
  private invoke(callback: () => void): void {
    try {
      callback()
    } catch {
      // 忽略调用方回调异常
    }
  }
}
