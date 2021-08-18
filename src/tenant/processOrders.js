import path from 'path'
import os from 'os'
import {Model, Order, OrderFactory } from '../models'
import { getFileSuffix } from '../utils/tools'
import addOrderShipment from './addOrderShipment'
import {createShippingLabels} from '../processShippingLabel'

/**
 * order status: open / partial / closed
 * 
 * @param {object} orders 
 * @param {string} tenantKey 
 * @param {import('../utils/dbAccessor').default} dbAccessor 
 */

async function uploadOrderToDb (orders, tenantKey, dbAccessor) {
  // adjust queue length here
  const queueLength = 5000
  const historyOrderIdRef = dbAccessor.buildStoreQuery(['tenants', tenantKey, 'uploadHistory', 'historyOrderIds'])
  let qty = 0
  await dbAccessor.updateInTransaction(async transaction => {
    const historyDoc = await transaction.get(historyOrderIdRef)

    if (historyDoc.exists) {
      let { historyOrderIds = [] } = historyDoc.data()
      let historyAddEntries = []
      let tempEntries = []
      const historySet = new Set(historyOrderIds.map(item => item.key))
      const lastPurchaseDate = historyOrderIds[0] ? historyOrderIds[0].purchaseDate : 0
      let ordersToAdd = []

      orders.forEach(order => {
        let {platform, orderId, purchaseDate} = order
        const orderKey = `${platform}-${orderId}`
        if (!historySet.has(orderKey)) {
          if (purchaseDate.getTime() > lastPurchaseDate || historyOrderIds.length < queueLength) {
            ordersToAdd.push({orderKey, order: dbAccessor.addNewDocTimestamp({ ...order, status: 'open' })})
            historyAddEntries.push({ key: orderKey, purchaseDate: purchaseDate.getTime() })
          } else {
            tempEntries.push({ orderKey, purchaseDate, order: dbAccessor.addNewDocTimestamp({ ...order, status: 'open' }) })
          }
        }
      })

      let promises = tempEntries.map(item => transaction.get(dbAccessor.buildStoreQuery(['tenants', tenantKey, 'orders', item.orderKey])))

      let rtn = await Promise.all(promises)
      rtn.forEach((doc, index) => {
        if (!doc.exists) {
          let { orderKey, purchaseDate, order } = tempEntries[index]
          ordersToAdd.push({orderKey, order})
          historyAddEntries.push({key: orderKey, purchaseDate})
        }
      })
      
      historyOrderIds = [...historyOrderIds, ...historyAddEntries]
      historyOrderIds.sort((a, b) => a.purchaseDate - b.purchaseDate)
      historyOrderIds.splice(0, historyOrderIds.length - queueLength)

      if (historyAddEntries.length > 0) {
        transaction.update(historyDoc.ref, dbAccessor.addUpdateDocTimestamp({historyOrderIds}))
      }

      ordersToAdd.forEach(item => {
        const {orderKey, order} = item
        qty += 1
        transaction.set(Order.getRef(tenantKey, orderKey), order)
      })
    } else {
      let historyAddEntries = []
      orders.forEach(order => {
        qty += 1
        transaction.set(Order.newRef(tenantKey, `${order.platform}-${order.orderId}`), dbAccessor.addNewDocTimestamp({ ...order, status: 'open' }))
        historyAddEntries.push({ 
          key: `${order.platform}-${order.orderId}`, 
          purchaseDate: order.purchaseDate.getTime() 
        })
      })
      transaction.set(historyOrderIdRef, dbAccessor.addNewDocTimestamp({ historyOrderIds: historyAddEntries }))
    }
  })
  return qty
}

// function deleteActiveOrders (activeOrderDocs, uploadMap) {
//   const activeSet = new Set(activeOrderDocs.map(doc => doc.id))

//   activeSet.forEach(orderKey => {
//     if (!uploadSet.has(orderKey)) {
//       let order = uploadMap.get(orderKey)
//       transaction.update(order.getRef(order.getKey()), {status: 'dismissed'})
//     }
//   })
// }

const FILE_SUFFIXES = ['txt', 'csv', 'xls', 'xlsx']

/*eslint consistent-return: 0*/
async function uploadOrders (data, context) {
  const { dbAccessor, bucket } = context.appContext
  let { uploadedFiles, tenantKey } = data
  if (!uploadedFiles) return
  
  uploadedFiles.forEach(file => {
    file.localPath = path.join(os.tmpdir(), file.name)
  })

  
  await Promise.all(uploadedFiles.map(file => bucket.file(file.fullPath).download({ destination: file.localPath })))

  return Promise.all(uploadedFiles.map(async file => {
    try {
      if (!FILE_SUFFIXES.includes(getFileSuffix(file.name))) {
        throw Error(`Order file must be [${FILE_SUFFIXES.join(', ')}].`)
      }
  
      // todo: Make different order Instance through OrderFactory class 
      let {orders, platform} = OrderFactory.createOrderFromFile(file, tenantKey)
  
      if (orders.length === 0) return {qty: orders.length, platform} 
  
      let mergedOrders = OrderFactory.mergeSameIdOrders(orders)
  
      const batchSize = 400
      let batches = []
      let qty = 0
    
      mergedOrders.forEach(order => {
        let thisBatch = batches[batches.length - 1]
        if (thisBatch && thisBatch.length < batchSize) {
          thisBatch.push(order)
        } else {
          batches.push([order])
        }
      })
    
      for (let batch of batches) {
        qty += await uploadOrderToDb(batch, tenantKey, dbAccessor)
      }
    
      return { qty, platform }
    } catch (error) {
      logger.error(error)
      return file.name
    }
  }))
}

async function addOrderLabel(data, context) {
  const {dbAccessor} = context.appContext
  let { labels, clientKey, clientName, isBeta = false } = data
  const uspsLabels = []
  const fedexLabels = []
  const upsLabels = []
  labels.forEach(label => {
    const {carrier} = label
    if (carrier.toLowerCase() === 'usps') {
      uspsLabels.push(label)
    }
    if (carrier.toLowerCase() === 'fedex') {
      fedexLabels.push(label)
    }
    if (carrier.toLowerCase() === 'ups') {
      upsLabels.push(label)
    }
  })

  const {successLabels: uspsSuccessLabels, errorLabels: uspsErrorLabels, existedLabels: uspsExistedLabels} = await createShippingLabels(uspsLabels, dbAccessor, {clientKey, clientName, isBeta},true)
  const {successLabels: fedexSuccessLabels, errorLabels: fedexErrorLabels, existedLabels: fedexExistedLabels} = await createShippingLabels(fedexLabels, dbAccessor, {clientKey, clientName, isBeta},true)
  const {successLabels: upsSuccessLabels, errorLabels: upsErrorLabels, existedLabels: upsExistedLabels} = await createShippingLabels(upsLabels, dbAccessor, {clientKey, clientName, isBeta},true)
  const successLabels = [...uspsSuccessLabels, ...fedexSuccessLabels, ...upsSuccessLabels]
  const errorLabels = [...uspsErrorLabels, ...fedexErrorLabels, ...upsErrorLabels]
  const existedLabels = [...uspsExistedLabels, ...fedexExistedLabels, ...upsExistedLabels]

  return {successLabels: [...successLabels, ...existedLabels], errorLabels}
}


export default function processOrders (data, context) {
  const { type } = data

  if (type === 'upload') {
    return uploadOrders(data, context)
  }

  if (type === 'addOrderShipment') {
    return addOrderShipment(data, context)
  }

  if (type === 'addOrderLabel') {
    return addOrderLabel(data, context)
  }
}