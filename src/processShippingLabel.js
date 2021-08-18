import axios from 'axios'
import {toMoney, addNumbers, axiosWrapper, ExpenseHistory, splitKeyword, MeasurementTools} from './utils/tools'
import env from './config/env'
import {updateLabelStatus} from './shippingLabelCallback'

export default async function processShippingLabel (data, context) {
  const { dbAccessor, bucket } = context.appContext
  // console.log({data})
  let { type, label, labels, clientKey = '', clientName = '', orderId, isBeta = false } = data
  
  if (type === 'create') {
    return JSON.parse(JSON.stringify(await createShippingLabels(labels, dbAccessor, {clientKey, clientName, isBeta})))
  }

  if (type === 'createInternational') {
    return JSON.parse(JSON.stringify(await createShippingLabelInternational(label, dbAccessor, {clientKey, clientName, isBeta})))
  }

  if (type === 'status') {
    return checkLabelStatus(orderId, bucket)
  }

  if (type === 'getRates') {
    return getRates(label, clientKey)
  }

  if (type === 'editNote') {
    return editNote(label, dbAccessor)
  }

  if (type === 'cancel') {
    return cancelLabel(label, dbAccessor, clientKey)
      .catch(error => {
        if (error.message === 'label-canceled') {
          return Promise.resolve('success')
        }
        throw error
      })
  }

  return Promise.resolve()
}

function labelPreprocess(resLabels, labelPayloadMap, newBalance, finalAmount, clientKey, clientName, discount) {
  // console.log({resLabels, labelPayloadMap})
  const labelDataArray = resLabels.reduce((acc, resLabel) => {
    const label = labelPayloadMap.get(resLabel.requestId)
    const {keywords: labelKeywords, carrier, packages, memo: labelMemo} = label
    const {requestId, weight: invoiceWeight, estimatedDelivery = 'N/A', currentBalance, amountDetails, totalAmount, orderId, ratedPackages = [], ...rest} = resLabel
    let keywords = generateKeywords({ ...label, ...resLabel })
    keywords.push(carrier.toLowerCase())
    labelKeywords && keywords.push(...splitKeyword(labelKeywords), labelKeywords)
    keywords = [...new Set(keywords)]
    
    return [...acc, ...packages.map((pkg, index) => {
      const {
        sequenceNumber = 1, 
        length, 
        height,
        width, 
        weight, 
        originHeight,  
        originLength,
        originWidth,
        originWeight,
        memo: pkgMemo, 
        ...restInfo
      } = pkg
      const labelKey = `${requestId}${sequenceNumber === 1 ? '' : (sequenceNumber > 10 ? `ml${sequenceNumber - 1}` : `ml0${sequenceNumber - 1}`)}`
      let [prefix, body, suffix] = orderId.split('-')
      
      if (ratedPackages && ratedPackages.length) {
        suffix = ratedPackages.find(item => item.sequenceNumber === sequenceNumber).orderId.split('-')[2]
      }
      return {
        ...restInfo,
        ...label,
        ...rest,
        weight: originWeight || weight,
        orderId: `${prefix}-${labelKey}-${suffix}`,
        labelKey,
        requestId,
        invoiceWeight,
        clientKey,
        clientName,
        hasShipment: false,
        status: 'pending',
        keywords: [...keywords, `${requestId}${sequenceNumber === 1 ? '' : (sequenceNumber > 10 ? `ml${sequenceNumber - 1}` : `ml0${sequenceNumber - 1}`)}`],
        estimatedDelivery: estimatedDelivery === 'N/A' ? null : new Date(estimatedDelivery),
        amountDetails,
        totalAmount: index === 0 ? calculateSingleFinalAmount(discount, carrier, totalAmount, amountDetails) : 0,
        discount: discount[carrier.toLowerCase()] || 0,
        packaging: {
          length: originLength || length, 
          height: originHeight || height, 
          width: originWidth || width
        },
        sequenceNumber,
        memo: pkgMemo || labelMemo
      }
    })]
  }, [])
  const log = {
    type: 'label',
    newBalance,
    amount: -finalAmount,
    note: `Label for ${labelDataArray.map(label => label.labelKey).join(', ')}`,
    clientKey,
    clientName,
    discount: labelDataArray[0].discount || 0,
    keywords: [...new Set(labelDataArray.reduce((acc, label) => label.keywords ? [...acc, ...label.keywords, label.labelKey] : acc, []))],
    amountDetails: resLabels.map((label) => label.amountDetails),
    details: resLabels.reduce((acc, resLabel) => {
      let label = labelPayloadMap.get(resLabel.requestId)
      const {packages = [], ...rest} = label
      const {
        requestId, 
        ratedPackages = [], 
        estimatedDelivery = 'N/A', 
        weight: shipmentWeight = 0, 
        billingWeight: shipmentBillingWeight = 0, 
        ...resRest
      } = resLabel
      let map = new Map(ratedPackages.map(item => [item.sequenceNumber, item]))
      return [...acc, ...packages.map(pkg => {
        const {sequenceNumber = 1} = pkg
        return {
          ...rest,
          ...resRest,
          labelKey: `${requestId}${sequenceNumber === 1 ? '' : (sequenceNumber > 10 ? `ml${sequenceNumber - 1}` : `ml0${sequenceNumber - 1}`)}`,
          requestId,
          ...pkg,
          ...(map.get(pkg.sequenceNumber) || {}),
          estimatedDelivery: estimatedDelivery === 'N/A' ? null : new Date(estimatedDelivery),
          shipmentWeight,
          shipmentBillingWeight,
          sequenceNumber
        }
      })]
    }, [])
  }
  return {labelDataArray, log}
}

export async function createShippingLabels (labels, dbAccessor, {clientKey, clientName, isBeta = false}, isUpdateOrders) {
  // shipment requestId's length is 16
  // labels created based on shipment has a requestId of length 19  
  let successLabels = []
  let errorLabels = []
  let existedLabels = []
  if (labels.length === 0) return {successLabels, errorLabels, existedLabels}
  
  const resLabels = await requestForLabels(labels, dbAccessor, {clientKey, clientName, isBeta})
  const labelPayloadMap = new Map(labels.map(labelPayload => [labelPayload.requestId, labelPayload]))

  const transactionStartTime = Date.now()

  resLabels.forEach((label) => {
    if (label.status === 'error') {
      logger.log('create label error: ', label)
      errorLabels.push(label)
    } else if (label.status === 'existed') {
      logger.log('label exists: ', label)
      existedLabels.push(label)
    } else {
      logger.log('create label success: ', new Date().toISOString(), label)
      successLabels.push(label)
    }
  })
  const errorRtn = preprocessErrors(errorLabels, labelPayloadMap)

  //check existedLabels, if some does not exist in this system, then put it in successLabel
  let finalExistedLabels = []
  await Promise.all(existedLabels.map(async anExistedLabel => {
    let labelDoc = await dbAccessor.query('labels', anExistedLabel.requestId)
    if (labelDoc.exists) {
      finalExistedLabels.push(anExistedLabel)
    } else {
      successLabels.push(anExistedLabel)
    }
  }))
  existedLabels = finalExistedLabels

  if (!successLabels.length) return {successLabels: [], errorLabels: errorRtn, existedLabels}
  const transactionUpdateStartTime = Date.now()
  //save success labels to database
  const labelDataArray = await dbAccessor.updateInTransaction(async transaction => {
    const {newBalance, finalAmount, discount, clientName} = await updateBalance(successLabels, clientKey, transaction, dbAccessor)
    const {labelDataArray, log} = labelPreprocess(successLabels, labelPayloadMap, newBalance, finalAmount, clientKey, clientName, discount)

    if (isUpdateOrders) {
      updateOrder(transaction, successLabels, labelPayloadMap, clientKey, dbAccessor, labels[0].keywords)
    }

    labelDataArray.forEach((labelPayload) => {
      const {labelKey, ...rest} = labelPayload
      transaction.set(dbAccessor.buildStoreQuery(['labels', labelKey]), dbAccessor.addNewDocTimestamp(rest))
    })
    transaction.set(dbAccessor.buildStoreQuery(['systemTransactions']).doc(), dbAccessor.addNewDocTimestamp(log))
    return labelDataArray
  })

  logger.log(`Post Create label processing time: ${Date.now() - transactionStartTime} ms, ${Date.now() - transactionUpdateStartTime} ms`)

  return {
    successLabels: labelDataArray.map(item => {
      return {
        ...item,
        _key: item.labelKey
      }
    }), 
    errorLabels: errorRtn, 
    existedLabels
  }
}

export async function createShippingLabelInternational (label, dbAccessor, {clientKey, clientName, isBeta = false}) {
  // shipment requestId's length is 16
  // labels created based on shipment has a requestId of length 19
  const labelPayloadMap = new Map([[label.requestId, label]])
  const resLabel = await requestForLabelInternational(label, dbAccessor, {clientKey, clientName, isBeta})

  const labelDataArray = await dbAccessor.updateInTransaction(async transaction => {
    const {newBalance, finalAmount, discount, clientName} = await updateBalance([resLabel], clientKey, transaction, dbAccessor)
    const {labelDataArray, log} = labelPreprocess([resLabel], labelPayloadMap, newBalance, finalAmount, clientKey, clientName, discount)

    labelDataArray.forEach((labelPayload) => {
      const {labelKey, ...rest} = labelPayload
      transaction.set(dbAccessor.buildStoreQuery(['labels', labelKey]), dbAccessor.addNewDocTimestamp(rest))
    })
    transaction.set(dbAccessor.buildStoreQuery(['systemTransactions']).doc(), dbAccessor.addNewDocTimestamp(log))
    return labelDataArray
  })
  return {
    successLabels: labelDataArray.map(item => {
      return {
        ...item,
        _key: item.labelKey
      }
    }), 
    errorLabels: [], 
    existedLabels: []
  }
}

function preprocessErrors (errorLabels, labelPayloadMap) {
  return errorLabels
    .map(error => {
      const {requestId} = error
      const label = labelPayloadMap.get(requestId)
      const {orderKey} = label
      return {
        ...error,
        orderKey
      }
    })
}

function generateKeywords (label) {
  let {memo, from, to, note, shippingService, requestId, serviceDescription, carrier, shipmentId, trackingNumber = '', ratedPackages = [], itn = ''} = label
  return [
    ...new Set([
      shipmentId, 
      carrier, 
      requestId,
      to.fullName, 
      from.fullName, 
      ...splitKeyword(note || ''), 
      from.state, 
      to.state, 
      shippingService, 
      serviceDescription, 
      from.zipCode, 
      to.zipCode, 
      memo.trim(), 
      trackingNumber,
      itn,
      'label',
      ...ratedPackages.map(pkg => pkg.orderId.split('-')[1])
    ]
      .filter(item => item !== '' && typeof item === 'string')
      .map(item => item.toLowerCase()))
  ]
}

function calculateSingleFinalAmount (discount = {}, carrier, totalAmount, amountDetails) {
  return toMoney(totalAmount - (discount[carrier.toLowerCase()] || 0) / 100 * (amountDetails.postageAmount || 0))
}

function calculateFinalPostageAmount (discount = {}, carrier, amountDetails) {
  return toMoney((amountDetails.postageAmount || 0)  *  (100- (discount[carrier.toLowerCase()] || 0))/ 100)
}


async function updateBalance (labels, clientKey, transaction, dbAccessor) {
  const balanceRef = dbAccessor.buildStoreQuery(['systemBalance', clientKey])
  const balanceDoc = await transaction.get(balanceRef)

  if (balanceDoc.exists) {
    let {balance = 0, expenseHistory = [], discount = {}, clientName} = balanceDoc.data()
    let history = new ExpenseHistory(expenseHistory)

    let finalAmount = toMoney(labels.reduce((acc, label) => {
      const {totalAmount, amountDetails = {}, carrier} = label
      return acc + calculateSingleFinalAmount(discount, carrier, totalAmount, amountDetails)
    }, 0))

    transaction.update(balanceDoc.ref, dbAccessor.addUpdateDocTimestamp({
      balance: addNumbers(balance, -finalAmount),
      expenseHistory: history.addExpense(finalAmount)
    }))

    return {newBalance: addNumbers(balance, -finalAmount), finalAmount, discount, clientName}
  } else {
    let history = new ExpenseHistory()
    let finalAmount = toMoney(labels.reduce((acc, label) => {
      const {totalAmount, amountDetails = {}, carrier} = label
      return acc + calculateSingleFinalAmount({}, carrier, totalAmount, amountDetails)
    }, 0))

    let expenseHistory = history.addExpense(finalAmount)
    const clientDoc = await dbAccessor.query('warehouses', clientKey)
    if (!clientDoc.exists) throw Error('Missing client doc.')
    const {name: clientName} = clientDoc.data()
    
    transaction.set(balanceDoc.ref, dbAccessor.addNewDocTimestamp({
      balance: -finalAmount,
      clientName,
      expenseHistory
    }))

    return {newBalance: -finalAmount, finalAmount, discount: 0, clientName}
  }
}

function updateOrder (transaction, successLabels, labelPayloadMap, clientKey, dbAccessor, keywords) {
  const processTime = new Date()
  successLabels.forEach(labelRes => {
    const {serviceType, carrier, requestId} = labelRes
    const label = labelPayloadMap.get(requestId)
    const {order, shipDate, orderKey} = label
    order.items.forEach(item => {
      item.quantityShipped += order.toShip[item.orderItemId]
    })

    const isOrderOpen = order.items.some(item => item.quantityPurchased !== item.quantityShipped)
    const shipments = dbAccessor.fieldArrayUnion(order.items.reduce((shipments, item) => {
      if (order.toShip[item.orderItemId]) {
        shipments.push({
          carrierCode: serviceType,
          carrierName: carrier,
          labelKey: requestId,
          quantity: order.toShip[item.orderItemId],
          orderItemId: item.orderItemId,
          shipDate: shipDate,
          status: 'pending',
          trackingNumber: ''
        })
      }
      return shipments
    }, []))


    const update = {
      items: order.items,
      status: !isOrderOpen ? 'closed' : 'partial',
      keywords: dbAccessor.fieldArrayUnion([...splitKeyword(keywords), keywords, 'label']),
      processTime,
      shipments
    }
    transaction.update(dbAccessor.buildStoreQuery(['tenants', clientKey, 'orders', orderKey]), dbAccessor.addUpdateDocTimestamp(update))
  })
}

async function checkLabelStatus (orderId, bucket) {
  const res = await axiosWrapper(axios({
    method: 'get',
    url: env.eeveeApi.url + 'shipment2/label/' + orderId,
    headers: { 
      'Content-Type': 'application/json',
      'x-api-key': env.eeveeApi.apiKey
    }
  }))

  if (!res.data.code) {
    await Promise.all(res.data.map(label => {
      if (label.status === 'OK') {
        logger.log('API response: ', label)
        return updateLabelStatus(label, bucket)
      }
      return Promise.resolve('skip')
    }))
  }
  
  return res.data
}

async function cancelLabel (label, dbAccessor, clientKey) {
  let res
  try {
    res = await axiosWrapper(axios({
      method: 'DELETE',
      url: `${env.eeveeApi.url}shipment2/label/${label.orderId}`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.eeveeApi.apiKey
      }
    }))
    logger.log('Delete label success: ', label.orderId)
  } catch (error) {
    logger.error('Delete label failed: ', label.orderId, error)
    if (error.errCode !== "label-canceled") {
      throw Error('label-canceled')
    }
  }

  const {requestId, totalAmount, trackingNumber = '', createTime, orderId, packages, order, orderKey} = label 
  const labelRefs = packages.length === 1 ? 
    [dbAccessor.buildStoreQuery(['labels', requestId])] : 
    packages.map(pkg => dbAccessor.buildStoreQuery(['labels', `${requestId}${pkg.sequenceNumber === 1 ? '' : (pkg.sequenceNumber > 10 ? `ml${pkg.sequenceNumber - 1}` : `ml0${pkg.sequenceNumber - 1}`)}`]))
  const balanceRef = dbAccessor.buildStoreQuery(['systemBalance', clientKey])
  const transactionRef = dbAccessor.buildStoreQuery(['systemTransactions']).doc()
  const clientDoc = await dbAccessor.query('warehouses', clientKey)
  if (!clientDoc.exists) throw Error('Missing client doc.')
  const {name: clientName} = clientDoc.data()

  return dbAccessor.updateInTransaction(async transaction => {
    const balanceDoc = await transaction.get(balanceRef)
    const labelDocs = await Promise.all(labelRefs.map(ref => transaction.get(ref)))
    let {balance, expenseHistory} = balanceDoc.data()
    let newExpenseHistory = new ExpenseHistory(expenseHistory)
    let details = []

    if (order && JSON.stringify(order) !== '{}') {
      const orderDoc = await transaction.get(dbAccessor.buildStoreQuery(['tenants', clientKey, 'orders', orderKey]))
      let {items} = orderDoc.data()
      if (orderDoc.exists) {
        items.forEach(item => {
          let {orderItemId} = item
          if (order.toShip[orderItemId]) {
            item.quantityShipped -= order.toShip[orderItemId]
          }
          // over shipped
          if (item.quantityShipped < 0) {
            throw Error(`Exceed purchase quantity for item orderItemId: ${orderItemId}`)
          }
        })
        transaction.update(orderDoc.ref, dbAccessor.addUpdateDocTimestamp({
          status: 'open', 
          items
        }))
      }
    }

    labelDocs.forEach(doc => {
      const {
        status, 
        amountDetails ={},
        billingWeight = 0,
        carrier = '',
        estimatedDelivery = new Date(),
        from = {},
        to = {},
        packaging = {},
        serviceType = '',
        serviceDescription = '',
        channel = '',
        channelDescription = '',
        zone = 0,
        weight = 0,
        requestId = '',
        orderId = '',
        trackingNumber = '',
        totalAmount: labelTotalAmount = 0
      } = doc.data()
      if (status === 'canceled') {
        throw Error('label-canceled')
      }
      const [ , labelKey = '' ] = orderId.split('-')
      details.push({
        amountDetails,
        billingWeight,
        carrier,
        estimatedDelivery,
        from,
        to,
        height: packaging.height || 0,
        length: packaging.length || 0, 
        width: packaging.width || 0,
        serviceType,
        serviceDescription,
        channel,
        channelDescription,
        zone,
        weight,
        labelKey,
        requestId,
        trackingNumber,
        orderId,
        totalAmount: labelTotalAmount
      })
      transaction.update(doc.ref, dbAccessor.addUpdateDocTimestamp({
        status: 'canceled'
      }))
    })

    transaction.update(balanceDoc.ref, dbAccessor.addUpdateDocTimestamp({
      balance: toMoney(balance + totalAmount),
      expenseHistory: newExpenseHistory.drawbackExpense(-totalAmount, new Date(createTime))
    }))
    transaction.set(transactionRef, dbAccessor.addNewDocTimestamp({
      amount: toMoney(totalAmount),
      newBalance: toMoney(balance + totalAmount),
      details,
      clientKey,
      clientName,
      note: `Cancel label ${packages.map(pkg => `${requestId}${(pkg.sequenceNumber || 1) === 1 ? '' : (pkg.sequenceNumber > 10 ? `ml${pkg.sequenceNumber - 1}` : `ml0${pkg.sequenceNumber - 1}`)}`).join(', ')}`,
      type: 'adjust',
      keywords: ['adjust', requestId, trackingNumber, orderId],
    }))
  })
}

export async function trackMultipleLabelByCarrier(carrier, trackingNumbers) {
  return axiosWrapper(axios({
    method: 'POST',
    url: `${env.eeveeApi.url}tracking/${(carrier || 'usps').toLowerCase()}`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.eeveeApi.apiKey
    },
    data: {trackingNumbers}
  }))
}

function adjustPackageMeasurementInPos (packages = [], isMeasurementMetric) {
  packages.forEach(pkg => {
    const {height, width, length, weight} = pkg
    if (isMeasurementMetric) {
      Object.assign(pkg, {
        height: MeasurementTools.cm_inch(height), 
        width: MeasurementTools.cm_inch(width), 
        length: MeasurementTools.cm_inch(length),
        weight: MeasurementTools.kg_lbs(weight),
        originHeight: height,
        originWidth: width,
        originLength: length,
        originWeight: weight
      })
    }
  })
}

async function requestForLabels (labels, dbAccessor, {clientKey, clientName, isBeta = false}) {
  const usps = []
  const fedex = []
  const ups = []
  const existedLabels = []
  const makeRequest = (provider, shipments) => {
    if (!shipments.length) return Promise.resolve([])
    if (shipments.length === 1) return axiosWrapper(axios({
      method: 'post',
      url: `${env.eeveeApi.url}shipment2/${provider}`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.eeveeApi.apiKey
      },
      data: {
        ...shipments[0],
        clientKey,
        clientName,
        isBeta
      }
    })).then(({data}) => [data])
    
    return axiosWrapper(axios({
      method: 'post',
      url: `${env.eeveeApi.url}shipment2/${provider}/batch`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.eeveeApi.apiKey
      },
      data: {
        shipments,
        clientKey,
        clientName,
        isBeta
      }
    })).then(({data}) => data.labels)
  }

  await Promise.all(labels.map(async label => {
    const {orderKey = '', carrier, packages = [], isMeasurementMetric = false} = label
    adjustPackageMeasurementInPos(packages, isMeasurementMetric)

    if (orderKey) {
      const orderDoc = await dbAccessor.query('tenants', clientKey, 'orders', orderKey)
      if (orderDoc.exists) {
        const {status} = orderDoc.data()
        if (status === 'closed' || status === 'archived') {
          existedLabels.push({...label, status: 'existed'})
          return
        }
      }
    }
    if (carrier.toLowerCase() === 'usps') {
      usps.push({...label, reference: JSON.stringify({orderKey})})
    }
    if (carrier.toLowerCase() === 'fedex') {
      fedex.push({...label, reference: JSON.stringify({orderKey})})
    }
    if (carrier.toLowerCase() === 'ups') {
      ups.push({...label, reference: JSON.stringify({orderKey})})
    }
  }))
  const res = await Promise.all([makeRequest('usps', usps), makeRequest('fedex', fedex), makeRequest('ups', ups)])
  const [uspsLabels, fedexLabels, upsLabels] = res
  res.forEach(labels => {
    labels.forEach(label => {
      if (label.reference) {
        Object.assign(label, JSON.parse(label.reference))
      }
    })
  })
  return [...uspsLabels, ...fedexLabels,...upsLabels, ...existedLabels]
}

function adjustFieldsInPos (packages = [], commodities = []) {
  packages.forEach(pkg => {
    pkg.insuredValue = pkg.insuredValue || pkg.declaredValue
  })

  commodities.forEach(item => {
    const {scheduleBDescription, customsValue = 0, quantity = 1, countryOfOrigin} = item
    item.commodityDescription = scheduleBDescription
    item.countryOfManufacture = countryOfOrigin
    item.unitPrice = toMoney(customsValue / quantity)
  })
}

async function requestForLabelInternational (label, dbAccessor, {clientKey, clientName}) {
  const {packages = [], commodities = [], isMeasurementMetric = false, signature, shippingService} = label
  adjustPackageMeasurementInPos(packages, isMeasurementMetric)
  adjustFieldsInPos(packages, commodities)
  
  const data = {
    ...label,
    clientKey, 
    clientName,
    signature: signature === 'NO_SIGNATURE_REQUIRED' ? 'INDIRECT' : signature
  }

  if (shippingService === 'INTERNATIONAL_ECONOMY_FREIGHT' || shippingService === 'INTERNATIONAL_PRIORITY_FREIGHT') {
    data.signature = signature === 'NO_SIGNATURE_REQUIRED' ? 'DIRECT' : signature
  }

  // console.log({data: JSON.stringify(data)})
  const res = await axiosWrapper(axios({
    method: 'post',
    url: `${env.eeveeApi.url}shipment2/fedex-international`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.eeveeApi.apiKey
    },
    data
  })).then(({data}) => data)

  // console.log({res: JSON.stringify(res)})
  return {
    ...res,
    carrier: 'fedex'
  }
}

async function getRates (label, clientKey) {
  // console.log({label})
  const {packages, commodities, isMeasurementMetric = false} = label
  adjustPackageMeasurementInPos(packages, isMeasurementMetric)
  adjustFieldsInPos(packages, commodities)

  let res = await axiosWrapper(axios({
    method: 'post',
    url: `${env.eeveeApi.url}rate2/${(label.carrier || 'usps').toLowerCase()}`,
    headers: { 
      'Content-Type': 'application/json',
      'x-api-key': env.eeveeApi.apiKey
    },
    data: {...label, clientKey}
  }))

  let {
    recommendAddress, 
    recipientAddressMatch, 
    recipientCityStateZipOK,
    totalAmount, 
    amountDetails = {}
  } = res.data

  if (label.discount) {
    res.data.totalAmount = calculateSingleFinalAmount(label.discount, label.carrier, totalAmount, amountDetails)
    res.data.amountDetails.postageAmount = calculateFinalPostageAmount(label.discount, label.carrier, amountDetails)
    if (res.data.moreRates) {
      res.data.moreRates.forEach(rate => {
        rate.totalAmount = calculateSingleFinalAmount(label.discount, label.carrier, rate.totalAmount, rate.amountDetails)
        rate.amountDetails.postageAmount = calculateFinalPostageAmount(label.discount, label.carrier, rate.amountDetails)
      })
    }
  }

  if (!recommendAddress) return res.data
  if (!recipientAddressMatch || !recipientCityStateZipOK) {
    return {
      notMatch: true,
      ...res.data
    }
  }
  return res.data
}

function editNote (label, dbAccessor) {
  let {note} = label

  return dbAccessor.updateFields({
    note,
    keywords: generateKeywords(label)
  }, 'labels', label._key)
}
