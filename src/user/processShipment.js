import sendCancelShipmentEmail from '../tenant/sendCancelShipmentEmail'
import moment from 'moment'

export default async function processShipment (data, context) {
  const { dbAccessor, bucket } = context.appContext
  // const {uid, token = {}} = data
  const {type, shipmentKey} = data
  if (type === 'cancel') {
    return cancelShipment(shipmentKey, dbAccessor, bucket, context)
  }
  return 'done'
}

export async function cancelShipment(
  shipmentKey, 
  dbAccessor, 
  bucket) 
{
  // reverse inventory
  // delete shipment
  // delete downloadable files
  let shipmentToCancel
  await dbAccessor.updateInTransaction(async transaction => {
    const {shipment,  relatedProducts = [], productDictionary} = await cancelShipmentGetDocs(dbAccessor, transaction, shipmentKey)
    let orderDoc
    if (shipment.orderChange) {
      orderDoc = await transaction.get(dbAccessor.buildStoreQuery([
        'tenants', 
        shipment.tenantKey,
        'orders',
        shipment.orderChange.orderInfo._key
      ]))
    }
    
    shipmentToCancel = shipment
    await cancelShipmentUpdateDocs(dbAccessor, transaction, shipment, relatedProducts, productDictionary, orderDoc)
  })

  await removeShipmentFilesAndSendEmail(dbAccessor, bucket, shipmentToCancel, shipmentToCancel.zipFile)

  return 'done'
}


export async function cancelShipmentGetDocs(dbAccessor, transaction, shipmentKey) {
  const shipmentDoc = await transaction.get(dbAccessor.buildStoreQuery(['shipments', shipmentKey]))
    let shipment = {_key: shipmentDoc.id, ...shipmentDoc.data()}
    const {products, tenantKey} = shipment
    let productDictionary = {}
    products.forEach(product => {
      if (productDictionary[product.id]) {
        productDictionary[product.id].push(product)
      } else {
        productDictionary[product.id] = [product]
      }
    })
    let transactionGets = Object
      .keys(productDictionary)
      .map(productId => transaction.get(dbAccessor.buildStoreQuery(['tenants', tenantKey, 'inventory', productId])))    
    let relatedProducts = await Promise.all(transactionGets)

    return {shipment,  relatedProducts, productDictionary}
}

export async function cancelShipmentUpdateDocs(dbAccessor, transaction, shipment, relatedProducts, productDictionary, orderDoc, options = {}) {
  const {warehouseKey, orderChange, trackingNum, tenantKey, userKey, labels = []} = shipment


  // update start
  if (orderChange) {
    let {orderInfo, ...skuToFulfillQty} = orderChange
    const {orderId = ''} = labels[0] || {}
    const labelId = orderId.split('-')[1] || ''
    
    if (orderDoc && orderDoc.exists) {
     await cancelShipmentUpdateOrderDoc(dbAccessor, transaction, shipment._key, orderDoc, skuToFulfillQty, labelId, {...options, trackingNum})
    }
  }

  relatedProducts.forEach(doc => {
    let originProduct = doc.data()
    if (!doc.exists) {
      console.error('System error, product does not exist')
    } else {
      const key = doc.id
      productDictionary[key].forEach(product => {
        // update quantity
        originProduct.quantity += product.toShip
        // update fbm
        let distribution = originProduct.distribution
        if (!distribution[product.fbmKey]) {
          let {siteName, uid, userName, warehouseSite, isCustom = false} = product
          distribution[product.fbmKey] = warehouseKey ? { quantity: 0, siteName, uid, userName, warehouseSite, warehouseKey, isCustom } : { quantity: 0, siteName, uid, userName, warehouseSite } 
        }
        distribution[product.fbmKey].quantity += product.toShip
      })
      const {quantity, distribution} = originProduct
      transaction.update(doc.ref, dbAccessor.addUpdateDocTimestamp({quantity, distribution}))
    }
  })
  transaction.delete(dbAccessor.buildStoreQuery(['shipments', shipment._key]))
  labels.forEach(label => {
    const labelRef = dbAccessor.buildStoreQuery(['labels', label.orderId.split('-')[1]])
    transaction.update(labelRef, dbAccessor.addUpdateDocTimestamp({ 
      shipmentId: dbAccessor.deleteField(),
      hasShipment: false,
      orderKey: dbAccessor.deleteField()
    }))
  })

  if (!warehouseKey && (tenantKey !== userKey)) {
    const predicates = [{
      field: `tenantKey`,
      compare: '==',
      value: tenantKey
    }, {
      field: `createTime`,
      compare: '<',
      value: moment().day(-3)
    }, {
      field: 'userKey',
      compare: '==',
      value: userKey
    }]
    
    const shipmentDocs = await dbAccessor.queryFirst(['shipments'], predicates)

    if (shipmentDocs.size === 0) {
      await dbAccessor.updateFieldRemoveFromSetArray('blockPaymentRequest', tenantKey, ['users', userKey])
    }
  }
}

export async function removeShipmentFilesAndSendEmail(dbAccessor, bucket, shipment, zipFile) {
  await Promise.all([
    zipFile ? bucket.file(zipFile).delete() : Promise.resolve('null zipFile'),
    sendCancelShipmentEmail(shipment, {appContext: {dbAccessor}})
  ])
}

export async function cancelShipmentUpdateOrderDoc(dbAccessor, transaction, shipmentKey, orderDoc, skuToFulfillQty, labelId, options = {}) {
  let {items, shipments = [], trackingNums = [], messages = []} = orderDoc.data()
  options.message && (messages = [options.message, ...messages])
  const trackingNum = options.trackingNum || ''

  items.forEach(item => {
    let {sku} = item
    if (skuToFulfillQty){
      if (skuToFulfillQty[sku]) {
        let {fulfillQty} = skuToFulfillQty[sku]
        item.quantityShipped -= fulfillQty
      }
    } else {
      const onlyLabelShipmentIndex = shipments.findIndex(shipment => shipment.labelKey === labelId)
      if (onlyLabelShipmentIndex >= 0) {
        const shipmentItem = shipments[onlyLabelShipmentIndex]
        const relatedItemIndex = items.findIndex(item => item.orderItemId === shipmentItem.orderItemId)
        if (relatedItemIndex >= 0) {
          items[relatedItemIndex].quantityShipped = items[relatedItemIndex].quantityShipped - shipmentItem.quantity
        }
      }
    }
    // over shipped
    if (item.quantityShipped < 0) {
      item.quantityShipped = 0
      console.error(`Exceed orderId[${orderDoc.id}] purchase quantity for item sku: ${sku}`)
    }
  })
  transaction.update(orderDoc.ref, dbAccessor.addUpdateDocTimestamp({
    status: shipments.filter(item => item.key !== shipmentKey && item.labelKey !== labelId).length > 0 ? 'partial' : 'open', 
    items, 
    shipments: shipments.filter(shipmentItem => shipmentItem.key !== shipmentKey && shipmentItem.labelKey !== labelId),
    trackingNums: trackingNums.filter(item => !trackingNum.split(' ').includes(item)),
    messages
  }))
}

