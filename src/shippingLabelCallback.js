/* eslint-disable no-await-in-loop */
import dbAccessor from './utils/dbAccessor'
import * as functions from 'firebase-functions'
import {processShipmentLabelFiles, sendShipmentEmail} from './shipmentLabelHelper'
import {cancelShipment, cancelShipmentGetDocs, cancelShipmentUpdateDocs, cancelShipmentUpdateOrderDoc, removeShipmentFilesAndSendEmail} from './user/processShipment'
import { ExpenseHistory, formatKeywords, toMoney } from './utils/tools'
// /**
//  * 	"{\n \"Type\" : \"SubscriptionConfirmation\",\n \"MessageId\" : \"dd0c2e97-629a-4f6d-bf5d-3c8c3f8d1db5\",\n \"Token\" : \"2336412f37fb687f5d51e6e2425f004aef17b12af9d5308d359bb79efc84ef7c82857c239fbfe80c19d3183dfa9406660036135dd4b884a64604e98c334b1d74a8f87f77a878a67b3b1cb9f8b8fa365e6ba26b5427563367cb2b6d72143e47344b310f706fefb665ed9f569f2e154cc5\",\n \"TopicArn\" : \"arn:aws:sns:us-east-1:816938363508:testByElbert\",\n \"Message\" : \"You have chosen to subscribe to the topic arn:aws:sns:us-east-1:816938363508:testByElbert.\\nTo confirm the subscription, visit the SubscribeURL included in this message.\",\n \"SubscribeURL\" : \"https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:us-east-1:816938363508:testByElbert&Token=2336412f37fb687f5d51e6e2425f004aef17b12af9d5308d359bb79efc84ef7c82857c239fbfe80c19d3183dfa9406660036135dd4b884a64604e98c334b1d74a8f87f77a878a67b3b1cb9f8b8fa365e6ba26b5427563367cb2b6d72143e47344b310f706fefb665ed9f569f2e154cc5\",\n \"Timestamp\" : \"2020-06-12T19:38:35.570Z\",\n \"SignatureVersion\" : \"1\",\n \"Signature\" : \"c26T9gXfeK0eB7inG5yiwxTkhrGmddEu9HBDSE7J/i/9GQXnNJoJjtRd0Wl05X+US0FD5fMlSHmS+NgyNRdR3BeE6kwu7sJy5c0SIuiP8ZPIycRuRvD3pg37g6QIKbCpFGYAxXFqP7RyPpoO87YeZGCWqL3xLYm/XCajCLSF2zMspfk77a8fKRl/TnOeS1pTTxjZ7LhS+xKS6oUJQwfceygxzBwR5hXzW82ORxxBV4kWZG/a8RYJuHTUJYWWJvO/Xlivunyp/yY9eao6aHQbGBiNKm1D6eld8kz7KyXIpnBKHqaQYUVvHN1IyydZ9z6XFfnpjgNI+IkWR4TGZ/Yepw==\",\n \"SigningCertURL\" : \"https://sns.us-east-1.amazonaws.com/SimpleNotificationService-a86cb10b4e1f29c941702d737128f7b6.pem\"\n}"
//  */
async function updateLabelStatus (data, bucket) {
  let {url, status, orderId, trackingNumber} = data
  const requestId = orderId.split('-')[1]

  const isUpdateShipment = requestId[16] === 'A'
  const isUpdateOrder = requestId[16] === 'B'
  const labelRef = dbAccessor.buildStoreQuery(['labels', requestId])
  let shipment
  try {
    await dbAccessor.updateInTransaction(async transaction => {
      const labelDoc = await transaction.get(labelRef)
      if (isUpdateShipment) {
        const shipmentKey = requestId.split('A')[0]
        const shipmentRef = dbAccessor.buildStoreQuery(['shipments', shipmentKey])
        const shipmentDoc = await transaction.get(shipmentRef)
        
        if (shipmentDoc.exists) {
          shipment = {key: shipmentDoc.id, ...shipmentDoc.data()}
          let {labels, trackingNum, status} = shipment

          if (status === 'created') {
            let targetLabel = labels.find(item => item.orderId === orderId)
            if (targetLabel.url === url) return 'done'
            targetLabel.url = url
            targetLabel.trackingNum = trackingNumber
    
            shipment.labels = labels
      
            transaction.update(shipmentDoc.ref, dbAccessor.addUpdateDocTimestamp({
              labels,
              trackingNum: trackingNum + ` ${trackingNumber}`,
              keywords: dbAccessor.dbFieldValue.arrayUnion(trackingNumber.toUpperCase()),
            }))
          } else {
            transaction.update(shipmentRef, {
              readyLabels: dbAccessor.dbFieldValue.arrayUnion({url, status, orderId, trackingNumber})
            })
          }
        } else {
          transaction.set(shipmentRef, dbAccessor.addNewDocTimestamp({
            status: 'pending',
            readyLabels: [{url, status, orderId, trackingNumber}]
          }))
        }
      }

      if (isUpdateOrder) {
        const {clientKey, orderKey} = labelDoc.data()
        const orderRef = dbAccessor.buildStoreQuery(['tenants', clientKey, 'orders', orderKey])
        const orderDoc = await transaction.get(orderRef)
        let {shipments = [], trackingNumber: originTracking} = orderDoc.data()
        let targetShipment = shipments.find(shipment => shipment.labelKey === requestId)

        if (targetShipment) {
          targetShipment.trackingNumber = trackingNumber
          targetShipment.labelUrl = url
          targetShipment.status = 'ready'
        } else {
          logger.log('Missing shipment in order: ', {shipments, requestId, orderId})
        }
        
        transaction.update(orderRef, dbAccessor.addUpdateDocTimestamp({
          trackingNumber: originTracking ? `${originTracking} ${trackingNumber}` : trackingNumber,
          shipments,
          keywords: dbAccessor.dbFieldValue.arrayUnion(trackingNumber.toLowerCase())
        }))
      }
      transaction.update(labelDoc.ref, dbAccessor.addUpdateDocTimestamp({  
        url, 
        status: 'ready',
        orderId,
        trackingNumber,
        keywords: dbAccessor.dbFieldValue.arrayUnion(trackingNumber.toLowerCase())
      }))
      return 'done'
    })

    if (isUpdateShipment && shipment && shipment.labels && shipment.labels.every(item => item.url)) {
      let zipFileInfo = await processShipmentLabelFiles(shipment, dbAccessor, bucket)
      await sendShipmentEmail(dbAccessor, shipment, zipFileInfo.zipfileDownloadURL)
    }
  } catch (e) {
    logger.error('ERROR: callback data: ', data, 'error:', e)
  }
  return 'done'
}

/**
 * @typedef InvoiceNotification
 * @property {string} status
 * @property {string} carrier
 * @property {string} orgKey
 * @property {number} balanceDiff
 * @property {string} requestId
 * @property {string} trackingNumber
 * @property {string} invoiceNumber
 * @property {object} invoice
 * @
 * @param {InvoiceNotification[]} data 
 */
async function processInvoiceNotification(data) {
  // transaction mode : transactionId-invoiceNumber
  // detail invoice
  const INVOICE_RECORDS_MAXIMUM = 5000
  function calculateTransactionAmountAndNewBalance(balance, balanceDiff, invoice, label) {
    let totalAmount = 0
    const {discount = 0, totalAmount: labelTotalAmount = 0} = label
    if (!discount) {
      totalAmount = balanceDiff
    } else {
      const {actualAmountDetails = {}} = invoice
      const {postageAmount = 0, ...surcharges} = actualAmountDetails
      let invoiceTotalAmount = 0
      if (postageAmount) {
        const newPostageAmount = postageAmount * (1 - discount / 100)
        invoiceTotalAmount = toMoney(invoiceTotalAmount + newPostageAmount)
      }
      invoiceTotalAmount =  Object.values(surcharges).reduce((total, surcharge) => toMoney(total + surcharge), invoiceTotalAmount)
      let originTotalAmount = invoice.type === 'adjust' ? labelTotalAmount : 0
      totalAmount = toMoney(invoiceTotalAmount - originTotalAmount)
    }

    const newBalance = toMoney(balance - totalAmount)
    return {newBalance, totalAmount}
  }

  function generateKeywords (requestId, invoiceObj) {
    const {carrier = '', invoiceNumber, trackingNumber, invoiceDate, type = ''} = invoiceObj
    return [
      'adjust',
      carrier,
      requestId, 
      invoiceNumber, 
      trackingNumber,
      `${requestId}-${invoiceNumber}`, 
      invoiceDate,
      type
    ].map(item => item.toLowerCase())
  }
  // loop for get old transaction
  // get rate of client
  const prepayLabels = await Promise.all(data.map(({requestId}) => dbAccessor.query('labels', requestId)))
  const clientKeyToUpdateTransactionMap = prepayLabels.reduce((mapObj, labelObj) => {
    if (labelObj.exists) {
      const {clientKey = ''} = labelObj.data()
      if (!clientKey) {
        logger.error(`transaction id: ${labelObj.id} no client key`)
        return mapObj
      }
      if (!mapObj[clientKey]) mapObj[clientKey] =  []
      mapObj[clientKey].push({
        labelDoc: labelObj,
        invoices: data.filter(({requestId}) => requestId === labelObj.id)
      })
    } else {
      logger.error(`requestId (${labelObj.id}) not found`)
    }
    
    return mapObj
  }, {})


  await Promise.all(
    Object.keys(clientKeyToUpdateTransactionMap).map(async clientKey => {
      const updatingTransactions = clientKeyToUpdateTransactionMap[clientKey]
      const requestIdsInTransaction = updatingTransactions.map(({labelDoc}) => labelDoc.id)
      logger.log(`Start to update ${clientKey} balance and invoice transactions \n ${requestIdsInTransaction.join(',')}`)
      const balanceRef = dbAccessor.buildStoreQuery(['systemBalance', clientKey])
      const invoiceRecordsRef = dbAccessor.buildStoreQuery(['systemBalance', clientKey, 'general', 'invoiceRecords'])
      await dbAccessor.updateInTransaction(async dbTransaction => {
        const [balanceDoc, invoiceRecordsDoc] = await Promise.all([dbTransaction.get(balanceRef), dbTransaction.get(invoiceRecordsRef)])
        let {balance = 0, expenseHistory = []} = balanceDoc.data()
        const balanceSnapshot = balance
        let history = new ExpenseHistory(expenseHistory)

        let invoiceRecordsSet = new Set(invoiceRecordsDoc.get('invoiceRecords') || [])

        const nowTimestamp = Date.now()
        let i = 0
        for (const updatingTransaction of updatingTransactions) {
          const {labelDoc, invoices} = updatingTransaction
          const label = labelDoc.data()
          const {clientName = '', discount = 0} = label
          for (const invoiceData of invoices) {
            const {carrier, trackingNumber, invoiceNumber, requestId, invoice, balanceDiff} = invoiceData
            if (invoiceRecordsSet.has(`${requestId}-${trackingNumber}-${invoiceNumber}`) || !balanceDiff) continue
            invoiceRecordsSet.add(`${requestId}-${trackingNumber}-${invoiceNumber}`)
            const {newBalance, totalAmount} = calculateTransactionAmountAndNewBalance(balance, balanceDiff, invoice, label)
            dbTransaction.set(
              dbAccessor.buildStoreQuery(['systemTransactions']).doc(),
              {
                clientKey,
                clientName,
                details: [{...invoice, discount}],
                createTime: new Date(nowTimestamp + i),
                lastModifiedTime: new Date(nowTimestamp + i),
                newBalance,
                note: `label ${requestId} invoice: ${invoiceNumber}`,
                amount: -totalAmount,
                type: "adjust",
                keywords: generateKeywords(requestId, invoice)
              }
            )
            balance = newBalance
            i += 1
          }

        }
        if (invoiceRecordsDoc.exists) {
          dbTransaction.update(invoiceRecordsDoc.ref, dbAccessor.addUpdateDocTimestamp({
            invoiceRecords: [...invoiceRecordsSet].slice(-INVOICE_RECORDS_MAXIMUM)
          }))
        } else {
          dbTransaction.set(invoiceRecordsDoc.ref, dbAccessor.addNewDocTimestamp({
            invoiceRecords: [...invoiceRecordsSet].slice(-INVOICE_RECORDS_MAXIMUM)
          }))
        }
        dbTransaction.update(balanceDoc.ref, dbAccessor.addUpdateDocTimestamp({
          balance,
          expenseHistory: history.addExpense(toMoney(balanceSnapshot - balance))
        }))
      })
    })
  )
}

async function setLabelFail (data, bucket) {
  // 
  const {requestId, message} = data
  const now = new Date()
  // get label and set label status to fail
  // build a transaction to refund the payment
  // reset related shipment and order
 
  await dbAccessor.updateInTransaction(async transaction => {
    const label = await transaction.get(dbAccessor.db.doc(`labels/${requestId}`))
    if (!label.exists) {
      logger.log(`Cannot find ${requestId} label`)
      return 'done'
    }
    const {clientKey, clientName = '', totalAmount = 0, orderKey = '', shipmentId = '', messages = [], trackingNumber = ''} = label.data()

    const newMessage = {
      time: now.toISOString(),
      message
    }
    const newMessages = [newMessage, ...messages]
    // check label related order and set the quantity back to not-send
    // check shipment and use helper function to cancel shipment
    
    //lock client balance
    const [balanceDoc, orderDoc, shipmentGetDocs] = await Promise.all([
      transaction.get(dbAccessor.db.doc(`systemBalance/${clientKey}`)),
      orderKey ? transaction.get(dbAccessor.db.doc(`tenants/${clientKey}/orders/${orderKey}`)) : null,
      shipmentId ? cancelShipmentGetDocs(dbAccessor, transaction, shipmentId) : null
    ])


    if (!shipmentId && orderDoc) { // handle only label order
      await cancelShipmentUpdateOrderDoc(dbAccessor, transaction, null, orderDoc, null, label.id, {message: newMessage, trackingNum: trackingNumber})
    }

    const {balance = 0, expenseHistory = []} = balanceDoc.data()
    let history = new ExpenseHistory(expenseHistory)
    transaction.update(label.ref, {
      status: 'failed',
      messages: newMessages
    })
    transaction.update(balanceDoc.ref, {
      balance: toMoney(balance + totalAmount),
      expenseHistory: history.addExpense(-totalAmount)
    })

    let details = (() =>{
      const {
        amountDetails ={},
        billingWeight = 0,
        carrier = '',
        estimatedDelivery = new Date(),
        from = {},
        to = {},
        packaging = {},
        serviceType = '',
        serviceDescription = '',
        zone = 0,
        weight = 0,
        requestId = '',
        orderId = '',
        trackingNumber = '',
        totalAmount: labelTotalAmount = 0
      } = label.data()
      const [ , labelKey = '' ] = orderId.split('-')
      return [{
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
        zone,
        weight,
        labelKey,
        requestId,
        trackingNumber,
        orderId,
        totalAmount: labelTotalAmount
      }]
    })()
    const transactionRef = dbAccessor.buildStoreQuery(['systemTransactions']).doc()
    transaction.set(transactionRef, dbAccessor.addNewDocTimestamp({
      amount: toMoney(totalAmount),
      newBalance: toMoney(balance + totalAmount),
      details,
      clientKey,
      clientName,
      note: `Create label fail: ${requestId}`,
      type: 'adjust',
      keywords: formatKeywords(['adjust', requestId, 'refund', 'failed']),
    }))
    if (shipmentId && shipmentGetDocs.shipment) {
      await cancelShipmentUpdateDocs(dbAccessor, transaction, shipmentGetDocs.shipment, shipmentGetDocs.relatedProducts, shipmentGetDocs.productDictionary, orderDoc, {message: newMessage})
      await removeShipmentFilesAndSendEmail( dbAccessor, bucket, shipmentGetDocs.shipment, shipmentGetDocs.shipment.zipFile)
    }
    return 'done'
  })
}

function shippingLabelCallback (bucket) {
  return functions.https.onRequest(async (req, res) => {
    try {
      logger.log('Request: ', req.protocol + '://' + req.get('host') + req.originalUrl, req.body)
      const {type, data=[]} = req.body
      switch(type) {
        case 'notification':
          data
            .filter(label => label.status.toLowerCase() !== 'ok')
            .forEach(label => {
              logger.error({label})
            })

          for (let label of data) {
            if (label.status.toLowerCase() === 'ok') {
              await updateLabelStatus(label, bucket)
            }
            else if (label.status.toLowerCase() === 'failed') {
              await setLabelFail(label, bucket)
            }
          } 
          
          break
        case 'invoice-notification':
          await processInvoiceNotification(data)
          break
        default:
          logger.error(data)
      }
    } catch (error) {
      logger.error("---------Error calling function:", error, req)
      // throw new functions.https.HttpsError('internal', error.message)
    }

    // labelId 需要throw 一个error
    res.json({
      status: 'done'
    })
  })
}

export {shippingLabelCallback, updateLabelStatus}
