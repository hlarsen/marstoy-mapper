if (typeof browser === "undefined") {
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
  };
}

document.addEventListener('DOMContentLoaded', () => {
  const { name } = browser.runtime.getManifest()
  document.title = `${name} Settings`
  document.querySelector('h2').textContent = `${name} Settings`

  browser.storage.sync.get(['apiKey', 'debugLogging']).then(result => {
    document.getElementById('apiKey').value = result.apiKey || ''
    document.getElementById('debugLogging').checked = result.debugLogging || false
  })

  document.getElementById('save').addEventListener('click', () => {
    const key = document.getElementById('apiKey').value.trim()
    const debug = document.getElementById('debugLogging').checked
    browser.storage.sync.set({ apiKey: key, debugLogging: debug }).then(() => {
      document.getElementById('status').textContent = 'Saved!'
      setTimeout(() => document.getElementById('status').textContent = '', 2000)
    })
  })
})
