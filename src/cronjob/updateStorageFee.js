import { addNumbers, toMoney, ExpenseHistory } from "../utils/tools"

export default async function updateStorageFee (data, context) {
  let {overrideFeeKey} = data
  let {dbAccessor} = context.appContext
  let predicates = [{
    field: 'hasRates', 
    compare: '==', 
    value: true
  }]
  let warehouseDocs = await dbAccessor.queryWithPredicates(predicates, 'warehouseLimitedInfo')
  let warehousesNeedUpdate = warehouseDocs.docs.filter(doc => {
    let {lastUpdateStorageFeeTime} = doc.data()
    return !lastUpdateStorageFeeTime || !isDayMonthYearEqual(lastUpdateStorageFeeTime.toDate()) || overrideFeeKey === '20180601'
  })

  let promises = warehousesNeedUpdate.map(async doc => {
    let warehouseKey = doc.id
    let {upc2RateMap, tenant2DiscountMap, inventories} = await upc2RateAndTenant2Discount(dbAccessor, warehouseKey)
    let {tenantDailyFeeMap, tenant2UpcsMap} = computeTenantDailyFee(upc2RateMap, tenant2DiscountMap, inventories)
    return updateTenantsBalances(dbAccessor, warehouseKey, tenantDailyFeeMap, tenant2UpcsMap, tenant2DiscountMap)
  })
  return Promise.all(promises)
}

async function upc2RateAndTenant2Discount (dbAccessor, warehouseKey) {
  let inventoryDocs = await dbAccessor.query('warehouses', warehouseKey, 'inventory')
  const startMemo = process.memoryUsage()
  let endMemo
  let inventories = inventoryDocs.docs
    .reduce((acc, doc, idx) => {
      let {distribution, abnormalDistribution = {}, tenantKey} = doc.data()
      let newDist = {}

      Object.entries(distribution).forEach(([upc, qty]) => {
        if (typeof qty !== 'number' || Number.isNaN(qty)) {
          logger.error('--- inventory qty error: ', {warehouseKey, upc, tenantKey})
        } else {
          newDist[upc] = newDist[upc] || 0
          newDist[upc] += qty >= 0 ? qty : 0
        }
      })

      Object.entries(abnormalDistribution).forEach(([upc, qty]) => {
        if (typeof qty !== 'number' || Number.isNaN(qty)) {
          logger.error('--- inventory qty error: ', {warehouseKey, upc, tenantKey})
        } else {
          newDist[upc] = newDist[upc] || 0
          newDist[upc] += qty >= 0 ? qty : 0
        }
      })

      Object.entries(newDist).forEach(([upc, quantity]) => {
        acc.push({
          upc, 
          quantity, 
          tenantKey
        })
      })
      if (idx === inventoryDocs.size - 1) {
        endMemo = process.memoryUsage()
      }
      return acc
    }, [])

  logger.log('Start memory: ', startMemo, '****', 'End memory: ', endMemo, '****', `${warehouseKey} Inventory size: `, inventories.length)
  let upcSet = new Set(inventories.map(product => product.upc))
  let tenantSet = new Set(inventories.map(product => product.tenantKey))
  const upcs = [...upcSet]
  let getUpcPromises = upcs.map(upc => dbAccessor.queryWithPredicates([{field: 'upc', compare: '==', value: upc}], 'warehouses', warehouseKey, 'upcs'))
  
  let upcDocs = await Promise.all(getUpcPromises)
  let ratesDoc = await dbAccessor.query('warehouseLimitedInfo', warehouseKey)
  let {rates} = ratesDoc.data()

  const {packageRates, unitRates} = rates
  const size2RateMap = new Map([
    ...unitRates.map(item => [item.name, item.storage]),
    ...unitRates.map(item => [item.sortKey, item.storage]),
    ['custom', 0]
  ])
  let upc2RateMap = new Map()
  upcDocs.forEach((docs, index) => {
    if (docs.size !== 0) {
      let {size, upc} = docs.docs[0].data()
      upc2RateMap.set(upc, size2RateMap.get(size) || 0)
    } else {
      let upc = upcs[index]
      upc2RateMap.set(upc, 0)
    }
  })
  let discountDocs = await Promise.all([...tenantSet]
    .map(tenantKey => dbAccessor.query('warehouses', warehouseKey, 'organizations', tenantKey)))
    
  let tenant2DiscountMap = new Map(discountDocs.map(doc => {
    if (doc.exists) {
      let {discountRate = 0, isStorageWaived = false} = doc.data()
      return [doc.id, isStorageWaived ? 100 : discountRate]
    }
    return []
  }))
  return {upc2RateMap, tenant2DiscountMap, inventories}
}

function computeTenantDailyFee (upc2RateMap, tenant2DiscountMap, inventories) {
  let tenantDailyFeeMap = new Map()
  let tenant2UpcsMap = new Map()
  inventories.forEach(product => {
    let {upc, quantity, tenantKey} = product
    let amount = quantity * upc2RateMap.get(upc) * (1 - tenant2DiscountMap.get(tenantKey) / 100)
    if (amount !== 0) {
      if (tenantDailyFeeMap.has(tenantKey)) {
        let balanceDiff = tenantDailyFeeMap.get(tenantKey)
        balanceDiff += amount
        tenantDailyFeeMap.set(tenantKey, balanceDiff)
      } else {
        tenantDailyFeeMap.set(tenantKey, amount)
      }
      if (tenant2UpcsMap.has(tenantKey)) {
        let newLog = tenant2UpcsMap.get(tenantKey)
        newLog.push({
          amount, upc, quantity, unitFee: upc2RateMap.get(upc)
        })
        tenant2UpcsMap.set(tenantKey, newLog)
      } else {
        tenant2UpcsMap.set(tenantKey, [{
          amount, upc, quantity, unitFee: upc2RateMap.get(upc)
        }])
      }
    }
  })
  return {tenantDailyFeeMap, tenant2UpcsMap}
}

function updateTenantsBalances (dbAccessor, warehouseKey, tenantDailyFeeMap, tenant2UpcsMap, tenant2DiscountMap) {
  let currentTime = new Date()
  let curKeyStr = `${currentTime.getFullYear()}-${currentTime.getMonth() + 1}`
  return dbAccessor.updateInTransaction(async transaction => {
    const keys = [...tenantDailyFeeMap.keys()]
    let billingDocs = await Promise.all(keys
      .map(tenantKey => transaction.get(dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'billings', `${warehouseKey}_${tenantKey}`]))))
    billingDocs.forEach((doc, index) => {
      let transactionRef = dbAccessor.getNewDocumentKey('warehouseTransactions')
      if (doc.exists) {
        let newBalance
        let {balance=0, expenseHistory=[], tenantKey} = doc.data()
        let balanceDiff = tenantDailyFeeMap.get(tenantKey)
        let history = new ExpenseHistory(expenseHistory)
        expenseHistory = history.addExpense(balanceDiff)

        newBalance = addNumbers((balance || 0), -balanceDiff)
        transaction.update(doc.ref, dbAccessor.addUpdateDocTimestamp({
          balance: newBalance, 
          expenseHistory
        }))
        let upcs = tenant2UpcsMap.get(tenantKey)
        transaction.set(transactionRef, dbAccessor.addNewDocTimestamp({
          upcs, 
          newBalance, 
          amount: -toMoney(balanceDiff), 
          discountRate: tenant2DiscountMap.get(tenantKey), 
          warehouseKey, 
          tenantKey, 
          transactionType: 'fee', 
          subtype: 'storage',
          workerKey: 'system',
          workerName: 'system'
        }))
      } else {
        let tenantKey = keys[index]
        let balanceDiff = tenantDailyFeeMap.get(tenantKey)
        let newBalance = toMoney(-balanceDiff)

        let history = new ExpenseHistory()
        let expenseHistory = history.addExpense(balanceDiff)

        transaction.set(doc.ref, dbAccessor.addNewDocTimestamp({
          balance: newBalance, 
          expenseHistory, 
          tenantKey
        }))
        let upcs = tenant2UpcsMap.get(tenantKey)
        transaction.set(transactionRef, dbAccessor.addNewDocTimestamp({
          upcs, 
          newBalance, 
          amount: -toMoney(balanceDiff), 
          discountRate: tenant2DiscountMap.get(tenantKey), 
          warehouseKey, 
          tenantKey, 
          transactionType: 'fee', 
          subtype: 'storage',
          workerKey: 'system',
          workerName: 'system'
        }))
      }
    })
    transaction.update(dbAccessor.buildStoreQuery(['warehouseLimitedInfo', warehouseKey]), {lastUpdateStorageFeeTime: new Date()})
  })
    .then(() => 1)
    .catch((error) => {
      logger.log(error.message)
      return 0
    })
}

function isDayMonthYearEqual (a = new Date(), b = new Date()) {
  return (a.getDate() === b.getDate()) && (a.getMonth() === b.getMonth()) && (a.getFullYear() === b.getFullYear())
}
