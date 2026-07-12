/* onadiet — the live "try it on your device" demo.
   Real, in-browser image compression: it re-encodes your photo with the browser's own WebP encoder,
   measures the result's quality with the SAME SSIM the engine uses (both images decoded, luma 8×8),
   maps the five diet plans to encoder settings, and keeps your original if it can't honestly beat it.
   Nothing is uploaded — the proof gauge instruments every fetch/XHR and they stay at zero.

   Safety: everything runs in the browser tab's sandbox; no network, no filesystem, no eval. Dropped
   files are untrusted, so we validate the type, cap the file size and pixel dimensions BEFORE any
   heavy canvas work (a small file can decode to a huge image — a decompression bomb — and hang the
   tab), wrap decode/encode in try/catch so a bad file never gets the UI stuck, and revoke object
   URLs so repeated loads don't leak memory. Interpolated result values are numbers/known strings —
   no untrusted text is ever written via innerHTML. */
;(function () {
  var drop = document.getElementById('demoDrop')
  if (!drop) return // the #try section isn't on this page — nothing to wire up

  // Guard rails for untrusted input. A browser <canvas> is itself capped (~4096px/side on Safari), and
  // we refuse rather than silently downscale (which would fake a saving) — the CLI has no such limit.
  var MAX_SIDE = 4096
  var MAX_FILE = 40 * 1024 * 1024

  // ---- the "on your device" proof: instrument fetch + XHR so any request would show; they never fire ----
  var reqs = 0,
    sent = 0
  function fmtB(n) {
    return n < 1024
      ? n + ' B'
      : n < 1048576
        ? (n / 1024).toFixed(1) + ' KB'
        : (n / 1048576).toFixed(2) + ' MB'
  }
  function paintMeter() {
    document.getElementById('demoReqs').textContent = reqs
    document.getElementById('demoSent').textContent = fmtB(sent)
  }
  var _fetch = window.fetch
  window.fetch = function () {
    reqs++
    try {
      var b = arguments[1] && arguments[1].body
      if (b && b.size) sent += b.size
    } catch (e) {
      /* ignore */
    }
    paintMeter()
    return _fetch.apply(this, arguments)
  }
  var _send = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function (body) {
    reqs++
    try {
      if (body) sent += body.size || body.length || 0
    } catch (e) {
      /* ignore */
    }
    paintMeter()
    return _send.apply(this, arguments)
  }

  // ---- diet plans → the browser codec's settings (WebP quality + optional downscale) ----
  // A browser can only shrink efficiently by re-encoding to WebP: a PNG re-saved as PNG GROWS ~6×
  // (a web page has no PNG optimizer), and WebP beats a re-encoded JPEG at the same quality. So the
  // demo always encodes WebP. KEEPING your source format (PNG→PNG, JPEG→JPEG via mozjpeg) or switching
  // to AVIF is a library capability the browser can't match — that's part of the funnel, not the demo.
  var PLANS = {
    cleanse: { q: 0.92, scale: 1, floor: null, tag: 'gentlest — highest quality' },
    lowcarb: { q: 0.82, scale: 1, floor: 0.96 },
    balanced: { q: 0.7, scale: 1, floor: 0.9 },
    keto: { q: 0.52, scale: 0.85, floor: 0.8 },
    crash: { q: 0.4, scale: 0.68, floor: null, tag: 'smallest — visible loss ok' },
  }
  var current = 'balanced',
    srcBlob = null,
    srcBitmap = null,
    srcType = 'image/jpeg',
    srcName = 'image',
    previewUrl = null,
    lastDownloadUrl = null,
    seq = 0

  function toBlob(canvas, type, q) {
    return new Promise(function (res) {
      canvas.toBlob(res, type, q)
    })
  }

  // luma of a bitmap sampled at w×h — the input to SSIM
  function lumaOf(bitmap, w, h) {
    var c = document.createElement('canvas')
    c.width = w
    c.height = h
    var ctx = c.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, w, h)
    var d = ctx.getImageData(0, 0, w, h).data,
      L = new Float64Array(w * h)
    for (var i = 0, j = 0; i < d.length; i += 4, j++)
      L[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    return L
  }
  // mean SSIM over non-overlapping 8×8 windows — the engine's perceptual floor, run in the browser
  function ssim(a, b, w, h) {
    var C1 = 6.5025,
      C2 = 58.5225,
      win = 8,
      total = 0,
      n = 0
    for (var y = 0; y + win <= h; y += win)
      for (var x = 0; x + win <= w; x += win) {
        var ma = 0,
          mb = 0,
          N = win * win,
          j,
          i,
          idx
        for (j = 0; j < win; j++)
          for (i = 0; i < win; i++) {
            idx = (y + j) * w + (x + i)
            ma += a[idx]
            mb += b[idx]
          }
        ma /= N
        mb /= N
        var va = 0,
          vb = 0,
          cov = 0,
          da,
          db
        for (j = 0; j < win; j++)
          for (i = 0; i < win; i++) {
            idx = (y + j) * w + (x + i)
            da = a[idx] - ma
            db = b[idx] - mb
            va += da * da
            vb += db * db
            cov += da * db
          }
        va /= N - 1
        vb /= N - 1
        cov /= N - 1
        total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2))
        n++
      }
    return n ? total / n : 1
  }
  async function measureSSIM(srcBmp, sw, sh, outBlob) {
    var outBmp = await createImageBitmap(outBlob)
    var cap = 512,
      s = Math.min(1, cap / Math.max(sw, sh))
    var w = Math.max(8, Math.round(sw * s)),
      h = Math.max(8, Math.round(sh * s))
    var val = ssim(lumaOf(srcBmp, w, h), lumaOf(outBmp, w, h), w, h)
    if (outBmp.close) outBmp.close()
    return val
  }

  // decode the inline sample locally — NO fetch/XHR, so the proof meter stays honestly at zero
  function dataURItoBlob(uri) {
    var parts = uri.split(','),
      mime = parts[0].match(/:(.*?);/)[1],
      bin = atob(parts[1])
    var arr = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return new Blob([arr], { type: mime })
  }

  function extFor(type) {
    return type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg'
  }
  function baseName(n) {
    n = (n || 'image').replace(/^.*[\\/]/, '') // strip any path
    var i = n.lastIndexOf('.')
    return (i > 0 ? n.slice(0, i) : n) || 'image'
  }

  var RESULT_SKELETON =
    '<div class="weigh">' +
    '<span class="lab">before</span><div class="track"><div class="fill before"></div></div><span class="num" id="dBefore">—</span>' +
    '<span class="lab">after</span><div class="track"><div class="fill after" id="dAfter" style="width: 100%"></div></div><span class="num" id="dAfterNum">—</span>' +
    '</div>' +
    '<div class="delta"><span class="big" id="dPct">—</span><span class="cap" id="dCap">pick a plan above</span></div>' +
    '<div class="receipt">' +
    '<div class="r"><span class="k">plan</span> <span id="dRcPlan"></span></div>' +
    '<div class="r"><span class="k">quality</span> <span id="dRcQual"></span></div>' +
    '<div class="r"><span class="k">where</span> <span class="ok" id="dRcWhere"></span></div>' +
    '</div>' +
    '<div class="dlrow">' +
    '<button class="dlbtn" id="dDownload" type="button" disabled>Download slimmed image</button>' +
    '<span class="dlnote" id="dDlNote"></span>' +
    '</div>'

  function ensureSkeleton() {
    var r = document.getElementById('demoResult')
    if (!document.getElementById('dAfter')) r.innerHTML = RESULT_SKELETON
    return r
  }

  function showMessage(msg) {
    var r = document.getElementById('demoResult')
    r.classList.remove('working')
    r.innerHTML = '<div class="idle err"></div>'
    r.firstChild.textContent = msg // textContent — never interpolate untrusted text into innerHTML
  }

  function setDownload(d) {
    var btn = document.getElementById('dDownload'),
      note = document.getElementById('dDlNote')
    if (d.kept || !d.out) {
      btn.disabled = true
      btn.onclick = null
      note.textContent = 'kept your original — nothing smaller to save'
      return
    }
    btn.disabled = false
    note.textContent = fmtB(d.finalSize) + ' · ' + extFor(d.type).toUpperCase()
    btn.onclick = function () {
      if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl)
      lastDownloadUrl = URL.createObjectURL(d.out)
      var a = document.createElement('a')
      a.href = lastDownloadUrl
      // ‹original name›-‹plan›-diet.‹real output ext› — e.g. vacation-keto-diet.webp
      a.download = baseName(srcName) + '-' + d.planKey + '-diet.' + extFor(d.type)
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
  }

  function applyResult(d) {
    ensureSkeleton()
    document.getElementById('dBefore').textContent = fmtB(srcBlob.size)
    document.getElementById('dAfterNum').textContent = fmtB(d.finalSize)
    document.getElementById('dAfter').style.width = 100 - Math.max(0, d.pct) + '%'
    document.getElementById('dPct').textContent = d.pct > 0 ? '−' + d.pct + '%' : '0%'
    document.getElementById('dCap').textContent = d.kept
      ? 'kept your original — nothing beat it honestly'
      : fmtB(srcBlob.size - d.finalSize) + ' lighter'
    var srcLabel = srcType === 'image/png' ? 'PNG' : srcType === 'image/webp' ? 'WebP' : 'JPEG'
    var from = srcType !== 'image/webp' ? ' (from ' + srcLabel + ')' : ''
    var scaleLabel = d.p.scale < 1 ? ' @' + Math.round(d.p.scale * 100) + '%' : ''
    document.getElementById('dRcPlan').textContent =
      d.planKey +
      ' · ' +
      (d.kept ? 'kept original' : 'WebP q' + Math.round(d.p.q * 100) + scaleLabel + from)
    var floor =
      d.p.floor == null
        ? d.p.tag || 'floorless'
        : 'floor ' +
          d.p.floor.toFixed(2) +
          (d.sm >= d.p.floor ? ' <span class="ok">✓</span>' : ' <span class="over">below</span>')
    document.getElementById('dRcQual').innerHTML = 'SSIM ' + d.sm.toFixed(3) + ' · ' + floor
    document.getElementById('dRcWhere').textContent = '✓ your browser — 0 bytes uploaded'
    setDownload(d)
  }

  async function compute(planKey) {
    var p = PLANS[planKey]
    var w = Math.max(1, Math.round(srcBitmap.width * p.scale)),
      h = Math.max(1, Math.round(srcBitmap.height * p.scale))
    var c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d').drawImage(srcBitmap, 0, 0, w, h)
    // always WebP — the only format a browser encodes efficiently (see PLANS note above)
    var type = 'image/webp'
    var out = await toBlob(c, type, p.q)
    // onadiet's rule: never write a bigger file — keep the original if we can't beat it
    var kept = !out || out.size >= srcBlob.size
    var finalBlob = kept ? srcBlob : out
    var sm = await measureSSIM(srcBitmap, srcBitmap.width, srcBitmap.height, finalBlob)
    return {
      planKey: planKey,
      p: p,
      type: type,
      out: out,
      kept: kept,
      finalSize: finalBlob.size,
      sm: sm,
      pct: Math.round((1 - finalBlob.size / srcBlob.size) * 100),
    }
  }

  async function run() {
    if (!srcBlob) return
    var my = ++seq
    var r = ensureSkeleton()
    r.classList.add('working')
    try {
      var d = await compute(current)
      if (my !== seq) return // a newer tap superseded this run — drop it (latest wins)
      applyResult(d)
    } catch (e) {
      if (my === seq) showMessage('Couldn’t process that image in this browser — try another.')
    } finally {
      if (my === seq) r.classList.remove('working')
    }
  }

  async function loadBlob(blob, name) {
    try {
      if (!blob || (blob.type || '').indexOf('image/') !== 0) {
        showMessage('That doesn’t look like an image — drop a JPEG, PNG, or WebP.')
        return
      }
      if (blob.size > MAX_FILE) {
        showMessage(
          'That file is ' +
            fmtB(blob.size) +
            ' — over the ' +
            fmtB(MAX_FILE) +
            ' demo cap. (The CLI has no limit.)',
        )
        return
      }
      var bmp = await createImageBitmap(blob)
      if (bmp.width > MAX_SIDE || bmp.height > MAX_SIDE) {
        if (bmp.close) bmp.close()
        showMessage(
          bmp.width +
            '×' +
            bmp.height +
            ' is over ' +
            MAX_SIDE +
            'px on a side — larger than a browser canvas can safely hold. (The CLI has no limit.)',
        )
        return
      }
      // release the previous image + preview so repeated loads don't leak
      if (srcBitmap && srcBitmap.close) srcBitmap.close()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      srcBlob = blob
      srcType = blob.type || 'image/jpeg'
      srcName = name || 'image'
      srcBitmap = bmp
      previewUrl = URL.createObjectURL(blob)
      drop.innerHTML = '<img class="prev" alt="your photo"/><div class="badge-img mono"></div>'
      drop.querySelector('.prev').src = previewUrl
      drop.querySelector('.badge-img').textContent =
        bmp.width + '×' + bmp.height + ' · ' + fmtB(srcBlob.size)
      drop.style.cursor = 'default'
      run()
    } catch (e) {
      showMessage('Couldn’t read that image — try another file.')
    }
  }

  // ---- wiring ----
  var file = document.getElementById('demoFile')
  document.getElementById('demoPick').onclick = function (e) {
    e.stopPropagation()
    file.click()
  }
  drop.onclick = function () {
    file.click()
  }
  file.onchange = function () {
    if (file.files[0]) loadBlob(file.files[0], file.files[0].name)
  }
  document.getElementById('demoSample').onclick = function (e) {
    e.stopPropagation()
    if (window.ONADIET_SAMPLE) loadBlob(dataURItoBlob(window.ONADIET_SAMPLE), 'blue-marble.jpg')
  }
  ;['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault()
      drop.classList.add('over')
    })
  })
  ;['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault()
      drop.classList.remove('over')
    })
  })
  drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer.files[0]
    if (f) loadBlob(f, f.name)
  })
  document.querySelectorAll('#demoPlans button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('#demoPlans button').forEach(function (x) {
        x.classList.remove('on')
      })
      b.classList.add('on')
      current = b.dataset.p
      run()
    }
  })
  paintMeter()
})()
