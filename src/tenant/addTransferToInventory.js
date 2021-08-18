import {addNumbers, toDateString} from '../utils/tools'
import moment from 'moment'

export default async function addTransferToInventory(data, context) {
  let dbAccessor = context.appContext.dbAccessor
  const {uid, token = {}} = context.auth
  let {key, pendingPeriod} = data
  let currentTime = new Date()
  let predicates = (upc) => [{
    field: 'upc',
    compare: '==',
    value: upc
  }]
  let items = []
  let toInventoryDocsArray = []

  await dbAccessor.updateInTransaction(async (transaction) => {
    let transferTransactionRef = dbAccessor.buildStoreQuery(['transferTransactions', key])
    let transferTransactionDoc = await transaction.get(transferTransactionRef)
    if (!transferTransactionDoc.exists) {
      throw Error('transfer-not-exists')
    }
    const {
      isPending, 
      isCanceled, 
      from, 
      toName, 
      to, 
      items: transferItems, 
      warehouseKey, 
      warehouseSite, 
      userKey, 
      userName
    } = transferTransactionDoc.data()

    if (!isPending) {
      if (isCanceled) {
        throw Error('transfer-was-canceled')
      }
      throw Error('transfer-was-already-added')
    }
    items = transferItems
    let warehouseFromInventoryRef = dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'inventory', `${warehouseSite}_${from}`])
    let warehouseToInventoryRef = dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'inventory', `${warehouseSite}_${to}`])
    toInventoryDocsArray = await Promise.all(items.map(item => dbAccessor.queryWithPredicates(predicates(item.upc), 'tenants', to, 'inventory')))
    let warehouseFromInventoryDoc = await transaction.get(warehouseFromInventoryRef)
    let warehouseToInventoryDoc = await transaction.get(warehouseToInventoryRef)
    // transaction get inventory 
    let inventories = await Promise.all(toInventoryDocsArray.map(querySnapshot => 
      querySnapshot.size === 1 ? transaction.get(querySnapshot.docs[0].ref) : {exists: false}
    ))

    if (userKey !== '') {
      let balanceDoc = await transaction.get(dbAccessor.buildStoreQuery(['balance', `${to}_${userKey}`]))
      let newTransactionRef = dbAccessor.getNewDocumentKey('transaction')
      let {total, cost} = updateBalance(transaction, balanceDoc, items, pendingPeriod)
      transaction.set(newTransactionRef, dbAccessor.addNewDocTimestamp({
        ...data, 
        transactionType: 'productTransfer', 
        newTotalBalance: total,
        amount: cost,
        tenantName: toName,
        userName,
        tenantKey: to,
        isPending: pendingPeriod === 0 ? false : true,
        pendingEndDate: pendingPeriod === 0 ? new Date() : moment(currentTime).add(pendingPeriod, 'days').toDate()
      }))  
    }

    inventories.forEach((productDoc, index) => {
      if (productDoc.exists) {
        updateTenantInventory(productDoc, items, transaction, dbAccessor)
      } else {
        logger.error(`Product missing ${items[index].upc}`)
      }
    })

    updateWarehouseFromInventory(warehouseFromInventoryDoc, items, transaction, dbAccessor)
    updateWarehouseToInventory(warehouseToInventoryDoc, items, warehouseSite, to, transaction, dbAccessor)

    transaction.update(transferTransactionRef, dbAccessor.addUpdateDocTimestamp({isPending: false}))
  })
  
  // search ProductDoc to add price history
  await Promise.all(items.map((item, index) => {
    if (toInventoryDocsArray[index].size > 0) {
      return addProductTransferPriceHistory(dbAccessor, toInventoryDocsArray[index].docs[0], item.unitPrice, item.toShip)
    } else {
      return Promise.resolve('skip price history update')
    }
  }))

  return 'success'
}

function updateTenantInventory (tenantInventoryDoc, items, transaction, dbAccessor) {
  let {distribution = {}, quantity = 0, inbound, upc} = tenantInventoryDoc.data()

  items.forEach(item => {
    if (upc !== item.upc) return 
    let {warehouseSite, uid, userName, warehouseKey, siteName, unitPrice, toShip} = item
    inbound += toShip
    quantity += toShip
    distribution[`warehouse${tenantInventoryDoc.id}${warehouseSite}`] = distribution[`warehouse${tenantInventoryDoc.id}${warehouseSite}`] || {
      siteName,
      quantity: 0,
      uid,
      userName,
      warehouseKey,
      warehouseSite
    }
    distribution[`warehouse${tenantInventoryDoc.id}${warehouseSite}`].quantity += toShip
  })
  transaction.update(tenantInventoryDoc.ref, dbAccessor.addUpdateDocTimestamp({distribution, quantity, inbound}))
}

function updateWarehouseFromInventory (warehouseFromInventoryDoc, items, transaction, dbAccessor) {
  if (!warehouseFromInventoryDoc || !warehouseFromInventoryDoc.exists) throw Error('warehouse-inventory-missing')
  let {distribution} = warehouseFromInventoryDoc.data()

  items.forEach(product => {
    let {upc, toShip} = product
    distribution[upc] -= toShip
    if (distribution[upc] < 0) throw Error('warehouse-inventory-below-zero')
    if (distribution[upc] === 0) delete distribution[upc]
  })
  transaction.update(warehouseFromInventoryDoc.ref, dbAccessor.addUpdateDocTimestamp({distribution}))
}

function updateWarehouseToInventory (warehouseToInventoryDoc, items, warehouseSite, to, transaction, dbAccessor) {
  let distribution
  if (!warehouseToInventoryDoc.exists) {
    distribution = {}
  } else {
    distribution = warehouseToInventoryDoc.data().distribution || {}
  }
  items.forEach(product => {
    let {upc} = product

    distribution[upc] = distribution[upc] || 0
    distribution[upc] += product.toShip
  })

  if (warehouseToInventoryDoc.exists) {
    transaction.update(warehouseToInventoryDoc.ref, dbAccessor.addUpdateDocTimestamp({distribution}))
  } else {
    transaction.set(warehouseToInventoryDoc.ref, dbAccessor.addNewDocTimestamp({distribution, siteKey: warehouseSite, tenantKey: to}))
  }
}

function updateBalance (transaction, balanceDoc, items, pendingPeriod) {
  if (!balanceDoc.exists) {
    logger.error ('balance document does not exist for this user and tenant: ', balanceDoc.id)
    throw Error('balance-doc-missing')
  }

  let userBalance = balanceDoc.data()
  let cost = items.reduce((acc, item) => {
    return addNumbers(acc, item.unitPrice * item.toShip)
  }, 0)

  let total = addNumbers((userBalance.total || 0), cost)

  if (pendingPeriod === 0) {
    let released = addNumbers((userBalance.released || 0), cost)
    transaction.update(balanceDoc.ref, {total, released})
  } else {
    let pending = addNumbers((userBalance.pending || 0), cost)
    transaction.update(balanceDoc.ref, {total, pending})
  }
  return {total, cost}
}

async function addProductTransferPriceHistory (dbAccessor, productDoc, price, quantity) {
  try {
    let [,tenantKey, ,productId] = productDoc.ref.path.split('/')
    const transferItem = { type: 'transfer', dateTime: new Date(), price, quantity }
    const ref = dbAccessor.buildStoreQuery(['tenants', tenantKey, 'priceHistory', productId])
    await dbAccessor.updateInTransaction(async transaction => {
      const priceHistoryDoc = await transaction.get(ref)
      if (priceHistoryDoc.exists) {
        const {inbound = []} = priceHistoryDoc.data()
        const findItem = inbound.find(item => 
          item.type === transferItem.type &&
          toDateString(item.dateTime.toDate()) === toDateString(transferItem.dateTime) &&
          item.price === transferItem.price
        ) 
        if (findItem) findItem.quantity += quantity
        else inbound.push(transferItem)
        return transaction.update(ref, dbAccessor.addUpdateDocTimestamp({inbound}))
      } else {
        return transaction.set(ref, dbAccessor.addNewDocTimestamp({
          inbound: [transferItem]
        }))
      }
    })
  } catch (error) {
    logger.error(productDoc.id, error)
  }
  return Promise.resolve('update price history finished')
}
