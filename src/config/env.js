'use strict'

let firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG)
let envType, url, eeveeApi, transactionFeeRate = 0.03
switch(firebaseConfig.projectId) {
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