import moment from 'moment'
import shipmentEmailHelper from './shipmentEmailHelper'

export default async function scanShipmentAlertEmail (data, context) {
  let {dbAccessor} = context.appContext
  let scanStartDate = moment(new Date()).subtract(3, 'days').toDate()
  let predicates = [{
    field: 'createTime',
    compare: '<=',
    value: scanStartDate
  }]
  let shipmentDocs = await dbAccessor.queryWithPredicates(predicates, 'shipments')
  let userKeys = {}
  let warehouseKeys = {}
  shipmentDocs.docs.forEach(doc => {
    let {userKey, warehouseKey, userName, tenantKey} = doc.data()
    if (warehouseKey) {
      if (warehouseKeys[warehouseKey]) {
        warehouseKeys[warehouseKey]++
      } else {
        warehouseKeys[warehouseKey] = 1
      }
    } else {
      if (userKey && userName != 'self') {
        if (userKeys[userKey]) {
          userKeys[userKey].push(tenantKey)
        } else {
          userKeys[userKey] = [tenantKey]
        }
      }
    }
  })
  let userEmails = []
  let warehouseEmails = []
  let promises = []
  let userDocs = await Promise.all(Object.keys(userKeys).map(userKey => {
    return dbAccessor.query('users', userKey)
  }))
  userDocs.forEach((doc) => {
    if (doc.exists) {
      let userEmail = doc.data().email
      if (userEmail) {
        userEmails.push(userEmail)
        userKeys[doc.id].forEach(tenantKey => {
          promises.push(dbAccessor.updateFieldAddToSetArray('blockPaymentRequest', [tenantKey], ['users', doc.id]))
        })
      }
    }
  })

  let warehouseDocs = await Promise.all(Object.keys(warehouseKeys).map(warehouseKey => {
    let warehousePredicates = [{
      field: 'warehouses',
      compare: 'array-contains',
      value: warehouseKey
    }]
    return dbAccessor.queryWithPredicates(warehousePredicates, 'users')
  }))
  
  warehouseDocs.forEach(warehouseDoc => {
    let warehouseEmail
    warehouseDoc.forEach(doc => {
      warehouseEmail = doc.data().email
    })
    warehouseEmail && (warehouseEmails.push(warehouseEmail))
  })
  shipmentEmailHelper([...userEmails, ...warehouseEmails])
  await Promise.all(promises)
  return 'success'
}