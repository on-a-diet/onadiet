// pool.mjs — a minimal worker pool so a server keeps its event loop free WITHOUT paying a worker-spawn cost
// per request.
//
// Because the engine holds no cross-call state, pooling is trivial: any worker serves any request, and there's
// nothing to reset between calls. For production you may prefer a battle-tested pool such as `piscina` — the
// same `worker.mjs` drops straight in; this hand-rolled version just keeps the example dependency-free.
import { Worker } from 'node:worker_threads'
import { availableParallelism } from 'node:os'

export function createSlimPool({ workerUrl, size = Math.max(1, availableParallelism() - 1) }) {
  const idle = []
  const queue = [] // waiting jobs: { bytes, request, resolve, reject, id? }
  const inFlight = new Map() // worker → the job it's currently serving
  let nextId = 0

  const spawn = () => {
    const worker = new Worker(workerUrl)
    worker.on('message', (msg) => {
      const job = inFlight.get(worker)
      inFlight.delete(worker)
      idle.push(worker)
      pump()
      if (job && job.id === msg.id) {
        if (msg.ok) job.resolve(msg.result)
        else job.reject(new Error(msg.error))
      }
    })
    worker.on('error', (err) => {
      // A crashed worker fails only ITS in-flight job; replace it so the pool self-heals.
      const job = inFlight.get(worker)
      inFlight.delete(worker)
      job?.reject(err)
      idle.push(spawn())
      pump()
    })
    return worker
  }

  const pump = () => {
    while (queue.length > 0 && idle.length > 0) {
      const job = queue.shift()
      const worker = idle.pop()
      job.id = nextId++
      inFlight.set(worker, job)
      // Structured clone (copy) the input in — robust for any `Uint8Array` the caller passes. If your inputs
      // are large AND you own a standalone `ArrayBuffer` (not a pool-backed Node Buffer), you can append a
      // transfer list `[job.bytes.buffer]` here for zero-copy; the pool-backed common case can't, so we copy.
      worker.postMessage({ id: job.id, bytes: job.bytes, request: job.request })
    }
  }

  for (let i = 0; i < size; i += 1) idle.push(spawn())

  return {
    /** Slim one file off the main thread. Resolves to the exact `SlimResult` `adapter.slim` would return. */
    slim(bytes, request = {}) {
      return new Promise((resolve, reject) => {
        queue.push({ bytes, request, resolve, reject })
        pump()
      })
    },
  }
}
