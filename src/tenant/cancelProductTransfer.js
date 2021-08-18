import {toTimestampTimezoneString} from '../utils/tools'
import sendMail from '../lib/sendGridEmailSender'

export default async function cancelProductTransfer(data, context) {
  let dbAccessor = context.appContext.dbAccessor
  const {uid, token = {}} = context.auth
  let {note, location, from, fromName, to, toName, items, warehouseKey, warehouseSite, key} = data

  return dbAccessor.updateInTransaction(async (transaction) => {
    let tenantInventoryRef = (productId) => dbAccessor.buildStoreQuery(['tenants', from, 'inventory', productId])

    let transferTransactionRef = dbAccessor.buildStoreQuery(['transferTransactions', key])
    let transactionGets = items.map((item) => transaction.get(tenantInventoryRef(item.id)))
    let gets = await Promise.all(transactionGets)

    updateTenantInventory(gets, items, warehouseKey, transaction, dbAccessor)

    transaction.update(transferTransactionRef, dbAccessor.addUpdateDocTimestamp({isPending: false, isCanceled: true}))
  })
    .then(() => {
      return sendEmail (data, dbAccessor)
    })
}

function updateTenantInventory (gets, items, warehouseKey, transaction, dbAccessor) {
  gets.forEach(doc => {
    if (!doc.exists) {
      logger.error('System error, product does not exist')
    } else {
      let originProduct = doc.data()
      let product = items.find(item => item.id === doc.id)
      // update quantity
      originProduct.quantity += product.toShip
      // update fbm
      let distribution = originProduct.distribution
      if (!distribution[product.fbmKey]) {
        let {siteName, uid, userName, warehouseSite, isCustom = false} = product
        distribution[product.fbmKey] = warehouseKey ? { quantity: 0, siteName, uid, userName, warehouseSite, warehouseKey, isCustom } : { quantity: 0, siteName, uid, userName, warehouseSite } 
      }
      distribution[product.fbmKey].quantity += product.toShip
      transaction.update(doc.ref, dbAccessor.addUpdateDocTimestamp(originProduct))
    }
  })
}

async function sendEmail (data, dbAccessor) {
  let {note, location, upc, from, fromName, toName, to, productName, productId, warehouseKey, warehouseSite, quantity, warehouseName} = data
  let predicates = [{
    field: 'warehouses',
    compare: 'array-contains',
    value: warehouseKey
  }]
  let warehouseDocs = await dbAccessor.queryWithPredicates(predicates, 'users')
  let tenantDoc = await dbAccessor.query('tenants', to)
  let {email, name} = tenantDoc.data()
  let receivers = [email, warehouseDocs.docs[0].data().email]
  let subject = `Cancel transfer request from: ${fromName} to: ${toName} - ${toTimestampTimezoneString(new Date())}`
  let body = `
    <p>Organization ${fromName} requests a transfer</p>
    <br>------------------------------
        <br>Product: ${productName}
        <br>Quantity: ${quantity}
        <br>Warehouse: ${warehouseName}
        <br>Site: ${location}
        <br>UPC: ${upc}
    <br>
    <br>
    ${
      note && `<br><b>Note:</b><br><div style="white-space: pre-wrap; overflow-wrap: break-word; color: blue">${note}</div>`
    }  
    `

  return sendMail(receivers, subject, body)

}