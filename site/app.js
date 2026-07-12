/* onadiet site — theme (dark by default), copy buttons, and the weigh-in reveal. No dependencies. */
;(function () {
  var root = document.documentElement
  function apply(t) {
    root.setAttribute('data-theme', t)
    var moon = document.getElementById('moon')
    var sun = document.getElementById('sun')
    if (moon && sun) {
      moon.style.display = t === 'dark' ? 'none' : 'block'
      sun.style.display = t === 'dark' ? 'block' : 'none'
    }
  }

  // Dark is the default — regardless of OS — unless the visitor has toggled to light before.
  var saved
  try {
    saved = localStorage.getItem('onadiet-theme')
  } catch (e) {}
  apply(saved === 'light' ? 'light' : 'dark')

  var btn = document.getElementById('theme')
  if (btn)
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
      apply(next)
      try {
        localStorage.setItem('onadiet-theme', next)
      } catch (e) {}
    })

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

  // copy-to-clipboard on command chips
  document.querySelectorAll('.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.cmd || '')
      var prev = b.textContent
      b.textContent = 'copied ✓'
      setTimeout(function () {
        b.textContent = prev
      }, 1400)
    })
  })

  // animate the weigh-in bar from full → slimmed when it scrolls into view
  var bar = document.getElementById('afterbar')
  if (bar && !reduce) {
    var target = bar.style.width || '53%'
    bar.style.width = '100%'
    new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            bar.style.width = target
            obs.disconnect()
          }
        })
      },
      { threshold: 0.4 },
    ).observe(bar)
  }
})()
