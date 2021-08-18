import { calculateOutboundWarehouseFee, calculateOtherServicesFee } from '../warehouse/warehouseHelper'
import { WarehouseStat } from '../utils/tools'
import moment from 'moment'

async function updateWarehouseStat (info, warehouseKey, warehouseSite, dbAccessor) {
  try {
    await dbAccessor.updateInTransaction(async transaction => {
      const doc = await transaction.get(dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'statistics', `${warehouseSite}_outbound`]))
      const { products, packageQty, workerKey, workerName } = info
      const units = products.reduce((acc, item) => acc + item.toShip, 0)
      let warehouseStat = new WarehouseStat(doc.data())
      warehouseStat.addStatByProducts({units, packages: packageQty}, workerKey, workerName)
     
      transaction.set(doc.ref, { ...warehouseStat.getData(), warehouseSite, warehouseKey, type: 'outbound' })
    })
  } catch (ex) {
    logger.error('update statistic failed. ', ex)
  }

  return 'finished'
}


export default async function confirmShipment (data, context) {
  let { dbAccessor } = context.appContext
  // const {uid, token = {}} = context.auth
  let { userType, payload, workerKey, workerName } = data
  let { 
    userKey, 
    tenantKey, 
    shipmentKey, 
    products, 
    warehouseKey, 
    packageQty, 
    isCustom, 
    confirmedOtherServices = [], 
    snRecords = [],
    extraFee = 1, 
    warehouseNote = '', 
    orderChange, 
    labels = [],
    uploadedTrackings = [],
    keywords = [],
    draftComments = []
  } = payload
  draftComments.forEach(comment => {
    comment.createTime = new Date(comment.createTime)
  })

  let archiveShipment = (transaction, shipmentDoc, payload) => {
    if (!shipmentDoc.exists) throw Error('shipment-missing')
    transaction.delete(shipmentDoc.ref)
    transaction.set(dbAccessor.buildStoreQuery(['archivedShipments', shipmentDoc.id]), {
      ...dbAccessor.addNewDocTimestamp(payload),
      shipmentCreateTime: payload.createTime,
      workerKey,
      workerName,
      keywords: [...keywords, ...uploadedTrackings, products[0].warehouseSite, ...snRecords]
        .map(item => item.toUpperCase())
    })
  }
  const getLabels = async (transaction, labels) => {
    return Promise.all(labels.map(label => {
      const [prefix, requestId, randomNum] = (label.orderId || '').split('-')
      if (requestId) return transaction.get(dbAccessor.buildStoreQuery(['labels', requestId]))
      return Promise.resolve(null)
    }))
  }

  const updateRelatedLabelStatus = (transaction, labelDocs = []) => {
    labelDocs.forEach(doc => {
      if (doc) transaction.update(doc.ref, dbAccessor.addUpdateDocTimestamp({
        status: 'in transit'
      }))
    })
  }

  let clearBlockPaymentRequest = (transaction, userDoc, userType, isShipmentLastOne) => {
    if (userType !== 'user') return 'Success'

    let { blockPaymentRequest } = userDoc.data()
    if (isShipmentLastOne && blockPaymentRequest && blockPaymentRequest.some(item => item === tenantKey)) {
      transaction.update(dbAccessor.buildStoreQuery(['users', userKey]), dbAccessor.addUpdateDocTimestamp({ blockPaymentRequest: blockPaymentRequest.filter(key => key !== tenantKey) }))
    }
  }
  const hasOrder = orderChange && JSON.stringify(orderChange) !== '{}'
  const orderRef = hasOrder && dbAccessor.buildStoreQuery(['tenants', tenantKey, 'orders', orderChange.orderInfo._key])
  let orderRelatedShipmentDocs
  if (hasOrder) {
    let [platform, ...rest] = orderChange.orderInfo._key.split('-')
    const predicates = [{
      field: 'relatedOrder',
      compare: '==',
      value: rest.join('-')
    }]
    orderRelatedShipmentDocs = await dbAccessor.queryWithPredicates(predicates, 'shipments')
  }

  if (userType === 'warehouse') {
    let upcsDocsPredicates = upc => [{ field: 'upc', compare: '==', value: upc }]
    let [discountDoc, ratesDoc, ...upcsDocsArray] = await Promise.all([
      dbAccessor.query('warehouses', warehouseKey, 'organizations', tenantKey),
      dbAccessor.query('warehouseLimitedInfo', warehouseKey),
      ...products.map(({ upc }) => dbAccessor.queryWithPredicates(upcsDocsPredicates(upc), 'warehouses', warehouseKey, 'upcs'))
    ])

    // otherRates Maybe not exist
    let { rates, otherRates = {} } = ratesDoc.data()
    let { discountRate = 0, isOutboundWaived = false } = discountDoc.data() || {}
    if (isOutboundWaived) discountRate = 100

    let upc2Size = new Map(upcsDocsArray.reduce((upcCollector, upcsDocs) => [
      ...upcCollector,
      ...upcsDocs.docs.map(doc => {
        let { upc, size } = doc.data()
        return [upc, size]
      })
    ], []))
    let otherServicesCalResult = calculateOtherServicesFee(upc2Size, otherRates, confirmedOtherServices, products, packageQty, extraFee, warehouseNote)

    let warehouseInventoryChange = {}
    products.forEach(product => {
      let { warehouseSite, toShip, upc } = product
      let warehouseInventoryKey = `${warehouseSite}_${tenantKey}`
      if (!warehouseInventoryChange[warehouseInventoryKey]) {
        warehouseInventoryChange[warehouseInventoryKey] = { [upc]: -toShip }
      } else if (!warehouseInventoryChange[warehouseInventoryKey][upc]) {
        warehouseInventoryChange[warehouseInventoryKey][upc] = -toShip
      } else {
        warehouseInventoryChange[warehouseInventoryKey][upc] -= toShip
      }
    })

    return dbAccessor.updateInTransaction(async (transaction) => {
      let [shipmentDoc, balanceDoc, labelDocs, uploadTrackingDoc] = await Promise.all([
        transaction.get(dbAccessor.buildStoreQuery(['shipments', shipmentKey])),
        transaction.get(dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'billings', `${warehouseKey}_${tenantKey}`])),
        getLabels(transaction, labels),
        transaction.get(dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'uploadHistory', 'uploadedTrackings']))
      ])

      let getInventoryPromises = Object.keys(warehouseInventoryChange).map(warehouseInventoryKey => {
        return transaction.get(dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'inventory', warehouseInventoryKey]))
      })
      let docs = await Promise.all(getInventoryPromises)

      if (hasOrder) {
        const orderDoc = await transaction.get(orderRef)
        const { items, shipments } = orderDoc.data()
        updateOrderShipments(items, shipments, shipmentKey, shipmentDoc, orderRelatedShipmentDocs.size, transaction, orderDoc, dbAccessor)
      }

      docs.forEach((doc) => {
        if (!doc.exists) throw Error('inventory-missing')
        let { distribution } = doc.data()
        let distributionChange = warehouseInventoryChange[doc.id]

        Object.keys(distributionChange).forEach(upc => {
          distribution[upc] += distributionChange[upc]
          if (!(distribution[upc] >= 0)) throw Error('distribution-quantity-error')
          if (distribution[upc] === 0) delete distribution[upc]
        })
        transaction.update(doc.ref, dbAccessor.addUpdateDocTimestamp({ distribution }))
      })
      archiveShipment(transaction, shipmentDoc, payload)
      updateRelatedLabelStatus(transaction, labelDocs)
      updateTrackingsCache(transaction, uploadTrackingDoc, uploadedTrackings)

      if (isCustom) return
      calculateOutboundWarehouseFee(transaction,
        dbAccessor,
        warehouseKey,
        tenantKey,
        rates,
        otherServicesCalResult,
        discountRate,
        products,
        packageQty,
        balanceDoc,
        upc2Size,
        workerKey,
        workerName)
    })
      .then(() => {
        let info = { products, packageQty, workerKey, workerName }
        let warehouseSite = products[0].warehouseSite
        return updateWarehouseStat(info, warehouseKey, warehouseSite, dbAccessor)
      })
  }

  if (userType === 'tenant') {
    if (hasOrder) {
      return dbAccessor.updateInTransaction(async transaction => {
        const [orderDoc, shipmentDoc, labelDocs] = await Promise.all([
          transaction.get(orderRef),
          transaction.get(dbAccessor.buildStoreQuery(['shipments', shipmentKey])),
          getLabels(labels)
        ])

        const { items, shipments } = orderDoc.data()
        updateOrderShipments(items, shipments, shipmentKey, shipmentDoc, orderRelatedShipmentDocs.size, transaction, orderDoc, dbAccessor)

        transaction.delete(dbAccessor.buildStoreQuery(['shipments', shipmentKey]))
        transaction.set(dbAccessor.buildStoreQuery(['archivedShipments']).doc(shipmentKey), dbAccessor.addNewDocTimestamp(payload))
        updateRelatedLabelStatus(transaction, labelDocs)
      })
    }
    let batch = dbAccessor.batch()
    batch.delete(dbAccessor.buildStoreQuery(['shipments', shipmentKey]))
    batch.set(dbAccessor.buildStoreQuery(['archivedShipments']).doc(shipmentKey), dbAccessor.addNewDocTimestamp(payload))
    return batch.commit()
  }

  if (userType === 'user') {
    let latestDateShipmentsNeedConfirm = moment(new Date()).subtract(3, 'days').toDate()
    let predicates = [
      {
        field: 'userKey',
        compare: '==',
        value: userKey
      },
      {
        field: 'tenantKey',
        compare: '==',
        value: tenantKey
      },
      {
        field: 'createTime',
        compare: '<=',
        value: latestDateShipmentsNeedConfirm
      }
    ]
    let shipmentsDocsNeedConfirm = await dbAccessor.buildStoreQueryPredicates(dbAccessor.buildStoreQuery(['shipments']), predicates, 'createTime', false, 2).get()
    let isShipmentLastOne = shipmentsDocsNeedConfirm.size === 1 && shipmentsDocsNeedConfirm.docs[0].id === shipmentKey

    return dbAccessor.updateInTransaction(async (transaction) => {
      let shipmentDoc = await transaction.get(dbAccessor.buildStoreQuery(['shipments', shipmentKey]))
      let getInventoryPromises = products.map(shipmentProduct => {
        let userProductInfoKey = `${tenantKey}_${shipmentProduct.id}`
        return transaction.get(dbAccessor.buildStoreQuery(['userLimitedInfo', userKey, 'inventory', userProductInfoKey]))
      })

      let userDoc = await transaction.get(dbAccessor.buildStoreQuery(['users', userKey]))
      let docs = await Promise.all(getInventoryPromises)
      let labelDocs = await getLabels(transaction, labels)

      if (hasOrder) {
        const orderDoc = await transaction.get(orderRef)
        const { items, shipments } = orderDoc.data()
        updateOrderShipments(items, shipments, shipmentKey, shipmentDoc, orderRelatedShipmentDocs.size, transaction, orderDoc, dbAccessor)
      }

      docs.forEach((doc, index) => {
        if (!doc.exists) throw Error('user inventory missing')
        let product = doc.data()
        let addressEncode = Buffer.from(products[index].warehouseSite).toString('base64')
        let distribution = product.distribution
        distribution[addressEncode].quantity -= products[index].toShip
        if (distribution[addressEncode].quantity < 0) throw Error('quantity-error')
        if (distribution[addressEncode].quantity === 0) delete distribution[addressEncode]
        let quantity = product['quantity'] - products[index].toShip
        let newValue = {
          distribution,
          quantity
        }
        if (quantity < 0) throw Error('quantity-error')
        if (quantity === 0 && Object.keys(distribution) === 0) {
          transaction.delete(doc.ref)
        } else {
          transaction.update(doc.ref, dbAccessor.addUpdateDocTimestamp(newValue))
        }
      })

      archiveShipment(transaction, shipmentDoc, payload)
      updateRelatedLabelStatus(transaction, labelDocs)
      clearBlockPaymentRequest(transaction, userDoc, userType, isShipmentLastOne)
    })
  }
}

function updateOrderShipments (items, shipments, shipmentKey, shipmentDoc, orderRelatedShipmentDocsSize, transaction, orderDoc, dbAccessor) {
  const labels = shipmentDoc.get('labels')
  let updateOrderData = {}
  if (items.every(item => item.quantityShipped === item.quantityPurchased) && orderRelatedShipmentDocsSize === 1) {
    updateOrderData = { status: 'closed' }
  }

  if (labels && labels.length) {
    shipments.forEach(shipment => {
      if (shipment.key === shipmentKey) {
        shipment.trackingNumber = labels[0].trackingNum || ''
        shipment.status = 'shipped'
        shipment.carrier = labels[0].carrier
        shipment.serviceType = labels[0].serviceType
        shipment.labelUrl = labels[0].url
      }
    })
    updateOrderData.shipments = shipments   
  }

  if (Object.keys(updateOrderData).length) {
    transaction.update(orderDoc.ref,  dbAccessor.addUpdateDocTimestamp(updateOrderData))
  }
}

function updateTrackingsCache (transaction, uploadTrackingDoc, uploadedTrackings) {
  if (uploadTrackingDoc.exists) {
    let {trackings = []} = uploadTrackingDoc.data()

    const trackingSet = new Set(trackings)
    uploadedTrackings.forEach(tracking => {
      if (trackingSet.has(tracking)) {
        throw Error(`Duplicate tracking: ${tracking}`)
      }
    })

    uploadedTrackings.forEach(tracking => {
      trackings.push(tracking)
    })
    while (trackings.length > 5000) {
      trackings.shift()
    }
    transaction.update(uploadTrackingDoc.ref, {trackings})
  } else {
    transaction.set(uploadTrackingDoc.ref, {trackings: uploadedTrackings})
  }
}
