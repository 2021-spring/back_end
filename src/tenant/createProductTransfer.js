import {toTimestampTimezoneString, getRandomIdByTime} from '../utils/tools'
import sendMail from '../lib/sendGridEmailSender'

export default async function createProductTransfer(data, context) {
  let dbAccessor = context.appContext.dbAccessor
  const {uid, token = {}} = context.auth
  let {note, location, from, fromName, toName, items, warehouseKey, warehouseSite, to} = data
  
  return dbAccessor.updateInTransaction(async (transaction) => {
    let tenantInventoryRef = (productId) => dbAccessor.buildStoreQuery(['tenants', from, 'inventory', productId])

    let transferTransactionRef = dbAccessor.buildStoreQuery(['transferTransactions']).doc()
    let transactionGets = items.map((item) => transaction.get(tenantInventoryRef(item.id)))
    let gets = await Promise.all(transactionGets)

    updateTenantInventory(gets, items, transaction, dbAccessor)
    
    let involvedKeys = [to, from, warehouseKey, ...items.reduce((acc, item) => [...acc, `${from}_${item.upc}`, `${to}_${item.upc}`], [])]
    transaction.set(transferTransactionRef, dbAccessor.addNewDocTimestamp({
      ...data, 
      to, 
      involvedKeys, 
      transactionId: getRandomIdByTime(3)
    }))
  })
    .then(() => {
      return sendEmail (data, dbAccessor)
    })
}

function updateTenantInventory (gets, items, transaction, dbAccessor) {
  gets.forEach(doc => {
    let originProduct = doc.data()
    if (!doc.exists) {
      throw Error('missing-product')
    } else {
      let product = items.find(item => item.id === doc.id)
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
      transaction.update(doc.ref, dbAccessor.addUpdateDocTimestamp(originProduct))
    }
  })
}

async function sendEmail (data, dbAccessor) {
  let {
    note, 
    location,
    fromName, 
    items, 
    toName, 
    to,
    warehouseKey,
    warehouseName
  } = data
  let predicates = [{
    field: 'warehouses',
    compare: 'array-contains',
    value: warehouseKey
  }]
  let warehouseDocs = await dbAccessor.queryWithPredicates(predicates, 'users')
  let tenantDoc = await dbAccessor.query('tenants', to)
  let {email} = tenantDoc.data()
  let receivers = [email, warehouseDocs.docs[0].data().email]
  let subject = `New transfer request from ${fromName} to ${toName} - ${toTimestampTimezoneString(new Date())}`
  let body = `
    <p>Organization ${fromName} requests a transfer</p>
    ${items.map(product => `    
      <br>------------------------------
      <br>Product: ${product.name}
      <br>Quantity: ${product.toShip}
      <br>Warehouse: ${warehouseName}
      <br>Site: ${location}
      <br>UPC: ${product.upc}
      <br>`
    ).join('')}
    <br>
    ${
      note && `<br><b>Note:</b><br><div style="white-space: pre-wrap; overflow-wrap: break-word; color: blue">${note}</div>`
    }    
    <br>
    <br>*** Please remember to add the transfer to your inventory.

    `

  return sendMail(receivers, subject, body)

}