/**
 * This is order models factory to make diff platform Order
 */
import fs from 'fs'
import xlsx from 'xlsx'
import {ModelError} from '../Error'
import Order from './Order'
import { PLATFORM_TO_MODEL, Platform,  HEADER_ROW_MAXIMUM, PLATFORM_TO_NAME} from './orderFactoryConfig'
import { getFileSuffix } from '../../utils/tools'



export default class OrderFactory {
  
  /**
   * 
   * @param {import('xlsx/types').WorkSheet[]} data 
   */
  static getPlatform(data) {
    let validationData = data
    if (Array.isArray(data)) {
      if (!data.length) throw new ModelError('empty-input', 'empty orders data')

      validationData = data[0]
    }
    let platform = Object.keys(PLATFORM_TO_MODEL).find(key => PLATFORM_TO_MODEL[key].validate(validationData)) 
    if (!platform) throw new ModelError('unknown-platform', 'cannot handle this platform data')
    return platform
  }

  /**
   * 
   * @param {object[]} data order data object
   * @param {string} tenantKey tenant key of firestore
   * @param {string} platform platform name
   */
  static createOrderInstance(data, tenantKey, platform) {
    const rtn = data.map(obj => 
      PLATFORM_TO_MODEL[platform.toLowerCase()]
        .sourceMapping(obj, tenantKey)
    ).filter(({orderId, orderItemId, sku}) => orderId && orderItemId && sku)
    PLATFORM_TO_MODEL[platform.toLowerCase()].clearCache()
    rtn.length === 0 && 
      PLATFORM_TO_MODEL[platform.toLowerCase()].checkNoOrders()

    return rtn
  }
  /**
   * 
   * @param {object | object[]} data 
   * @param {string} tenantKey
   * @param {Platform} [platform] 
   * @returns {{platform: string, orders: Order[]}}
   */
  static createOrderFromFile(file, tenantKey, platform) {
    let workbook 
    switch (getFileSuffix(file.name)) {
      case 'txt':
        // Only Amazon orders use this suffix 09-28-2020
        workbook = xlsx.read(fs.readFileSync(file.localPath).toString().replace(/"/g, ''), { type: 'string', raw: true })
        break
      case 'xlsx':
      case 'xls':
      case 'csv': 
        workbook = xlsx.readFile(file.localPath, { type: 'string', cellDates: true })
        break
    }
    const workSheet = workbook.Sheets[getSheetName(workbook.SheetNames)]
    let xlsxOpt = {}
    if (!(workSheet.A1 && workSheet.A1.v)) {
      for (let i = 1; i <= HEADER_ROW_MAXIMUM; i++) {
        if (workSheet['A' + i] || workSheet['B' + i]) {
          xlsxOpt = {
            range: (i - 1)
          }
          break
        }
      }
    }
    let rawData = xlsx.utils.sheet_to_json(workSheet, xlsxOpt) // lost zip code if zip code start with 0

    platform || (platform = this.getPlatform(rawData))
    return {
      platform: PLATFORM_TO_NAME[platform],
      orders: this.createOrderInstance(rawData, tenantKey, platform)
    }
  }

  /**
   * 
   * @param {Order[]} orders 
   * @returns {Order[]}
   */
  static mergeSameIdOrders(orders) {
    const [order] = orders
    if (!order) return orders
    const OrderType = order.constructor
    return OrderType.mergeOrders(orders)
  }
}

/** @param {string[] sheetNames} */
function getSheetName(sheetNames) {
  if (sheetNames.length > 1 && sheetNames[0] === 'Instructions') { // new egg xls file
    return 'BatchShippingUpdate'
  }
  return sheetNames[0]
}
