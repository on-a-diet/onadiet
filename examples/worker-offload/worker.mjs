// worker.mjs — runs a slim OFF the main event loop.
//
// The engine is a pure `(bytes, request) → SlimResult` call with no cross-call state, so it moves onto a
// worker thread with no locks and no per-call setup. This file is the offload target; `pool.mjs` drives it.
import { parentPort } from 'node:worker_threads'
import { imageAdapter } from '@onadiet/image'
import { pdfAdapter } from '@onadiet/pdf'
import { svgAdapter } from '@onadiet/svg'

/** Route bytes to the adapter that recognizes them (same precedence the `diet` CLI uses). */
function selectAdapter(bytes) {
  if (pdfAdapter.detect(bytes)) return pdfAdapter
  if (imageAdapter.detect(bytes)) return imageAdapter
  if (svgAdapter.detect(bytes)) return svgAdapter
  return null
}

parentPort.on('message', async ({ id, bytes, request }) => {
  try {
    const adapter = selectAdapter(bytes)
    if (adapter === null) {
      parentPort.postMessage({ id, ok: false, error: 'unrecognized file type' })
      return
    }
    const result = await adapter.slim(bytes, request)
    // `result` structured-clones cleanly (a plain outcome + a `Uint8Array | null`). We deliberately DON'T add
    // a transfer list: the output is a sharp Buffer backed by Node's shared 8 KB pool, whose `.buffer` isn't
    // transferable — and the output is the already-COMPRESSED file, so the clone copy is cheap anyway.
    parentPort.postMessage({ id, ok: true, result })
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: String(error) })
  }
})
