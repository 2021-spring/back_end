import {createShippingLabels} from '../processShippingLabel'
import dbAccessor from '../utils/dbAccessor'
import {splitKeyword, toPickerDateString} from '../utils/tools'
import {processShipmentLabelFiles, sendShipmentEmail} from '../shipmentLabelHelper'

export default async function addOrderShipment(data, context) {
  const {dbAccessor, bucket} = context.appContext
  let { labels, clientKey, clientName, shipments, keywords, isBeta = false } = data
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
  const {successLabels: uspsSuccessLabels, errorLabels: uspsErrorLabels, existedLabels: uspsExistedLabels} = await createShippingLabels(uspsLabels, dbAccessor, {clientKey, clientName, isBeta})
  const {successLabels: fedexSuccessLabels, errorLabels: fedexErrorLabels, existedLabels: fedexExistedLabels} = await createShippingLabels(fedexLabels, dbAccessor, {clientKey, clientName, isBeta})
  const {successLabels: upsSuccessLabels, errorLabels: upsErrorLabels, existedLabels: upsExistedLabels} = await createShippingLabels(upsLabels, dbAccessor, {clientKey, clientName, isBeta})
  const successLabels = [...uspsSuccessLabels, ...fedexSuccessLabels, ...upsSuccessLabels]
  const errorLabels = [...uspsErrorLabels, ...fedexErrorLabels, ...upsErrorLabels]
  const existedLabels = [...uspsExistedLabels, ...fedexExistedLabels, ...upsExistedLabels]
  let newShipments = shipmentPreprocess(shipments, successLabels, errorLabels, labels)
  await addMultipleShipments(newShipments, keywords, clientKey, dbAccessor, bucket)
  return {successLabels: [...successLabels, ...existedLabels], errorLabels}
}

async function addMultipleShipments(shipments, keywords, clientKey, dbAccessor, bucket) {
  let productDictionary = {}
  shipments.forEach(shipment => {
    shipment.products.forEach(product => {
      productDictionary[product.id] = productDictionary[product.id] || []
      productDictionary[product.id].push(product)
    })
  })
  const shipmentRefs = shipments.map(shipment => dbAccessor.buildStoreQuery(['shipments', shipment._key]))
  const inventoryRefs = Object.keys(productDictionary).map((productId) => dbAccessor.buildStoreQuery(['tenants', clientKey, 'inventory', productId]))
  const orderRefs = shipments.map(shipment => dbAccessor.buildStoreQuery([
    'tenants', 
    clientKey,
    'orders',
    shipment.orderChange.orderInfo._key
  ]))


  await dbAccessor.updateInTransaction(async (transaction) => {
    const [dbShipmentDocs, productDocs, orderDocs] = await Promise.all([
      Promise.all(shipmentRefs.map(shipmentRef => transaction.get(shipmentRef))),
      Promise.all(inventoryRefs.map(inventoryRef => transaction.get(inventoryRef))),
      Promise.all(orderRefs.map(orderRef => transaction.get(orderRef)))
    ])

    updateRelatedOrders(transaction, shipments, orderDocs, keywords)
    updateRelatedShipments(transaction, shipments, dbShipmentDocs, dbAccessor)
    updateRelatedInventories(transaction, productDictionary, productDocs, dbAccessor)
    updateRelatedLabels(transaction, shipments, dbAccessor)
  })

  await zipLabelsAndSendmail(shipments, dbAccessor, bucket)
}

function updateRelatedOrders(transaction, shipments, orderDocs, keywords) {
  const orderDocMap = new Map(orderDocs.map((orderDoc) => [orderDoc.id, orderDoc]))
  shipments.forEach(shipment => {
    let {orderInfo, ...skuToFulfillQty} = shipment.orderChange
    let {shipDate = toPickerDateString(new Date())} = shipment.selectedOrder || {}
    const orderDoc = orderDocMap.get(orderInfo._key)
    if (!orderDoc.exists) throw Error('Order doc not found.')
    let {items, status, shipments: orderShipments = []} = orderDoc.data()
    let orderShipment
    if (status === 'shipped') throw Error('Order has already been fulfilled.')
    items.forEach(item => {
      let {sku} = item
      if (skuToFulfillQty[sku]) {
        let {fulfillQty, orderItemId} = skuToFulfillQty[sku]
        item.quantityShipped += fulfillQty
        orderShipment = {
          key: shipment._key,
          orderItemId,
          quantity: fulfillQty,
          shipDate,
          carrierCode: shipment.carrier,
          carrierName: shipment.carrier,
          trackingNumber: shipment.trackingNum,
          status: 'pending'
        }
      }
      // over shipped
      if (item.quantityShipped > item.quantityPurchased) {
        throw Error(`OverShipped quantity for item sku: ${sku}`)
      }
    })
    orderShipments.push(orderShipment)
    if (items.some(item => item.quantityPurchased - item.quantityShipped > 0)) {
      transaction.update(orderDoc.ref, dbAccessor.addUpdateDocTimestamp({
        status: 'partial', 
        items, 
        shipments: orderShipments,
        keywords: dbAccessor.fieldArrayUnion([...splitKeyword(keywords), keywords, 'shipping']),
        processTime: new Date()
      }))
    } else {
      transaction.update(orderDoc.ref, dbAccessor.addUpdateDocTimestamp({
        status: 'closed', 
        items, 
        shipments: orderShipments,
        keywords: dbAccessor.fieldArrayUnion([...splitKeyword(keywords), keywords, 'shipping']),
        processTime: new Date()
      }))
    }
  })
}

function updateRelatedShipments(transaction, shipments, dbShipmentDocs, dbAccessor) {
  const dbShipmentDocMap = new Map(dbShipmentDocs.map(dbShipmentDoc => [dbShipmentDoc.id, dbShipmentDoc]))
  shipments.forEach(shipment => {
    const dbShipmentDoc = dbShipmentDocMap.get(shipment._key)
    if (!dbShipmentDoc.exists) {
      transaction.set(dbShipmentDoc.ref, dbAccessor.addNewDocTimestamp(shipment))
    } else {
      let {readyLabels} = dbShipmentDoc.data()
      shipment.labels.forEach(item => {
        let targetLabel = readyLabels.find(label => label.orderId === item.orderId)
        if (targetLabel) {
          item.url = targetLabel.url
          item.trackingNum = targetLabel.trackingNumber
        }
      })
      let trackingNumArray = readyLabels.map(item => item.trackingNumber)
      shipment.trackingNum = trackingNumArray.join(' ')
      shipment.keywords = [...shipment.keywords, ...trackingNumArray]
      transaction.update(dbShipmentDoc.ref, dbAccessor.addUpdateDocTimestamp(shipment))
    }
  })
}

function updateRelatedInventories(transaction, productDictionary, productDocs, dbAccessor) {
  productDocs.forEach(productDoc => {
    if (!productDoc.exists) {
      throw Error('missing-product')
    } 
    let originProduct = productDoc.data()
    const key = productDoc.id
    productDictionary[key].forEach(product => {
      // update quantity
      originProduct.quantity -= product.toShip
      // update fbm
      let distribution = originProduct.distribution
      if (distribution[product.fbmKey].quantity >= product.toShip) {
        distribution[product.fbmKey].quantity -= product.toShip
        if (distribution[product.fbmKey].quantity === 0) { delete distribution[product.fbmKey] }
      } else {
        throw Error('quantity error')
      }
    })
    transaction.update(productDoc.ref, dbAccessor.addUpdateDocTimestamp(originProduct))
  })
}

function updateRelatedLabels(transaction, shipments, dbAccessor) {
  shipments.forEach(shipment => {
    shipment.labels.forEach(label => {
      const labelRef = dbAccessor.buildStoreQuery(['labels', label.orderId.split('-')[1]])
      transaction.update(labelRef, {shipmentId: shipment._key, hasShipment: true})
    })
  })
}

function zipLabelsAndSendmail(shipments, dbAccessor, bucket) {
  return Promise.all(shipments.map(async shipment => {
    if (shipment.labels.every(item => item.url)) {
      const zipFileInfo = await processShipmentLabelFiles({...shipment, key: shipment._key}, dbAccessor, bucket)
      await sendShipmentEmail(dbAccessor, {...shipment, key: shipment._key}, zipFileInfo.zipfileDownloadURL)
    }
  }))
}

function shipmentPreprocess(shipments, successLabels, errorLabels, labels) {
  const successLabelMap = new Map(successLabels.map(labelPayload => [labelPayload.shipmentId, labelPayload]))
  const labelPayloadMap = new Map(labels.map(labelPayload => [labelPayload.shipmentId, labelPayload]))

  return shipments
    .filter(shipment => successLabelMap.has(shipment._key))
    .map(shipment => {
      const labelPayload = labelPayloadMap.get(shipment._key)
      const successLabel = successLabelMap.get(shipment._key)
      const {
        serviceType,
        shippingService: carrier,
        packages
      } = labelPayload
      const {
        orderId: labelOrderId,
      } = successLabel
      const {
        length, 
        width, 
        height
      } = packages[0]
      shipment.labels = [{
        orderId: labelOrderId,
        carrier,
        serviceType,
        packaging: {
          length, 
          width, 
          height
        }
      }]
      return shipment
    })
}