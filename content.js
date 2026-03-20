// Scans Marstoy pages and updates products that match sets via the Rebrickable API, caches data in localStorage
if (typeof browser === 'undefined') {
  // Chrome compatibility for Firefox-style API
  window.browser = {
    ...chrome,
    storage: {
      sync: {
        get: (keys) => new Promise(resolve => chrome.storage.sync.get(keys, resolve)),
        set: (items) => new Promise(resolve => chrome.storage.sync.set(items, resolve)),
      },
    },
    runtime: {
      ...chrome.runtime
    },
  }
}

(function () {
  const log = (...args) => DEBUG_LOGGING && console.log(`[Marstoy Mapper]`, ...args)

  function toRebrickableId (sku) {
    return sku.slice(1).split('').reverse().join('')
  }

  function extractSku (handle) {
    return handle.match(/\b([mn]\d{5,6})(?!\d)/i)?.[1]?.toUpperCase() ?? null
  }

  // Check cache
  function cacheGet (sku) {
    try {
      const raw = localStorage.getItem(`mf_${sku}`)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

  // Fetch data from Rebrickable API
  async function fetchProduct (sku) {
    const cached = cacheGet(sku)
    if (cached) {
      return cached
    }

    return (async () => {
      const url = `https://rebrickable.com/api/v3/lego/sets/${toRebrickableId(sku)}-1/`
      log('Fetching data from ' + url)
      try {
        const res = await fetch(url, {
          headers: { Authorization: `key ${API_KEY}` }
        })
        if (res.status === 429) {
          log('Rebrickable rate limited', sku)
          return null
        }
        if (!res.ok) {
          log('Rebrickable API error', res.status, sku)
          return null
        }

        const json = await res.json()
        if (!json.name) return null

        const data = { name: json.name.trim(), imageUrl: json.set_img_url || '' }
        try { localStorage.setItem(`mf_${sku}`, JSON.stringify(data)) } catch {}

        return data
      } catch (err) {
        log('Fetch error', sku, err)
        return null
      }
    })()
  }

  function processNonProductPage () {
    document.querySelectorAll('.advc-product-item__wrapper:not([data-already-processed])').forEach(processAdvcItem)
    document.querySelectorAll('product-item:not([data-already-processed])').forEach(processProductItem)
  }

  async function processProductItem (productItem) {
    if (productItem.dataset.alreadyProcessed) return
    productItem.dataset.alreadyProcessed = '1'

    const handle = productItem.dataset.productHandle || ''
    let sku = extractSku(handle)

    // fall back to another field - this should only happen on bad data (moc-n179957-parts-packs)
    if (!sku) {
      sku = (productItem.dataset.productFirstAvailableVariantSku || '').match(/^([MN]\d+)/i)?.[1] || null
    }

    if (!sku) {
      log('No SKU found for handle:', handle)
      return
    }

    const data = await fetchProduct(sku)
    if (!data) return

    const titleSpan = productItem.querySelector('a.block-product-title span')
    if (titleSpan) titleSpan.textContent = `[${toRebrickableId(sku)}] ${data.name}`

    if (data.imageUrl) {
      const img = productItem.querySelector('img.block-product-image__image')
      if (img) {
        img.src = data.imageUrl
        img.srcset = data.imageUrl
        img.alt = data.name
      }
    }

    log('Finished processing list page item:', sku, data.name)
  }

  // new display module on the front page, no product-item data
  async function processAdvcItem (wrapper) {
    if (wrapper.dataset.alreadyProcessed) return
    wrapper.dataset.alreadyProcessed = '1'

    const anchor = wrapper.querySelector('a[href]')
    if (!anchor) return

    const handle = anchor.getAttribute('href').replace('/products/', '')
    const sku = extractSku(handle)
    if (!sku) {
      log('No SKU found for advc handle:', handle)
      return
    }

    const data = await fetchProduct(sku)
    if (!data) return

    const titleEl = wrapper.querySelector('.advc-product-item-title')
    if (titleEl) titleEl.textContent = `[${toRebrickableId(sku)}] ${data.name}`

    if (data.imageUrl) {
      const img = wrapper.querySelector('img.advc-image')
      if (img) {
        img.src = data.imageUrl
        img.srcset = data.imageUrl
        img.alt = data.name
      }
    }

    log('Finished processing advc item:', sku, data.name)
  }

  async function processProductPage () {
    const titleElement = document.querySelector('h1.product-detail__title')
    if (!titleElement || titleElement.dataset.alreadyProcessed) return

    const handle = document.querySelector('theme-product-detail')?.dataset.handle || ''
    let sku = extractSku(handle)

    // fall back to another field, this should only happen on bad data (moc-n179957-parts-packs)
    if (!sku) {
      sku = document.querySelector('theme-product-variant-sku')?.textContent.match(/^([MN]\d+)/i)?.[1] || null
    }

    if (!sku) {
      log('No SKU found for handle:', handle)
      return
    }

    titleElement.dataset.alreadyProcessed = '1'

    const data = await fetchProduct(sku)
    if (!data) return

    titleElement.textContent = `[${toRebrickableId(sku)}] ${data.name}`

    if (data.imageUrl) {
      document.querySelectorAll('img.media-gallery__image, img.media-gallery__thumbnail-image')
        .forEach(img => {
          img.src = data.imageUrl
          img.srcset = data.imageUrl
          img.alt = data.name
          img.onload = () => {
            const ratio = img.naturalWidth / img.naturalHeight
            const carousel = document.querySelector('theme-carousel.media-gallery__content')
            if (carousel) carousel.style.setProperty('--current-media-aspect-ratio', ratio)
          }
        })
    }

    log('Finished processing product page:', sku, data.name)
  }

  function debounce (fn, delay) {
    let timer
    return (...args) => {
      clearTimeout(timer)
      timer = setTimeout(() => fn(...args), delay)
    }
  }

  // main
  let API_KEY = ''
  let DEBUG_LOGGING = false
  browser.storage.sync.get(['apiKey', 'debugLogging']).then(result => {
    API_KEY = result.apiKey || ''
    DEBUG_LOGGING = result.debugLogging || false

    if (!API_KEY) {
      log('No API key set — skipping. Set one in the extension options.')
      return
    }

    if (document.querySelector('h1.product-detail__title')) {
      log('Scanning product page')
      processProductPage().catch(err => log('Product page error', err))
    } else {
      log('Scanning non-product page')
      processNonProductPage()

      const debouncedScan = debounce(() => {
        log('DOM changed, re-scanning')
        processNonProductPage()
      }, 300)

      new MutationObserver(debouncedScan).observe(document.body, { childList: true, subtree: true })
    }
  })
})()
