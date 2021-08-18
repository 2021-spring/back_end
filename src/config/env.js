'use strict'

let firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG)
let envType, url, eeveeApi, transactionFeeRate = 0.03
switch(firebaseConfig.projectId) {
  case 'easygo-core':
    envType = 'core'
    url = 'https://easygo-core.firebaseapp.com'
    eeveeApi= {
      apiKey: 've00XEHIRh7ztSrNE3ulQ1FE7juXBmWY8BHd3pbi',
      url: 'https://test-api.vitedirect.com/'
    }
    break
  case 'viteusa-prod':
    envType = 'production'
    url = 'https://app.viteusa.com'
    eeveeApi= {
      apiKey: '73rOM9fzWI7KGk9NRvBU54KNoHs2apfd9TVlN6q4',
      url: 'https://api.vitedirect.com/'
    }
    break
  default:
    envType = 'development'
    url = 'http://localhost:8080'
    eeveeApi= {
      apiKey: 'Z4kDPeD56u6FmNoiWiCqJ2ltudEmCUGk5YcPLOPC',
      url: process.env.eeveeEmulator!=='true' ? 'https://test-api.vitedirect.com/' : 'http://localhost:3000/'
    }
    break
}

module.exports = {
  envType,
  url,
  eeveeApi,
  transactionFeeRate
}