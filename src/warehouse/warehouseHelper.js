import {toMoney, addNumbers, sleep, flatArray, ExpenseHistory} from '../utils/tools'

// this is to process packages from single warehouse and single site
async function updateInventoryPromise (dbAccessor, packages, warehouseKey, warehouseName, warehouseSite, siteName, isQuantityReverse = false) {
  let batchSize = 400
  let startPosition = 0
  let packageSize = packages.length
  let packagesUploaded = packages.map(pkg => 0)

  try {
    while(startPosition < packageSize) {
      // endPosition will not proccess this time, it will be the start position of next batch
      let endPosition = (startPosition + batchSize >= packageSize) ? packageSize : startPosition + batchSize
      logger.log('*** start processing: ', startPosition, endPosition)
      let packageBatch = packages.slice(startPosition, endPosition)
      let {packageBatchUploaded, packageIds} = await processPackagesBatch(dbAccessor, packageBatch, warehouseKey, warehouseName, warehouseSite, siteName, isQuantityReverse)
      packageBatchUploaded.forEach((item, index) => { packagesUploaded[startPosition + index] = item })
      logPackageIds(packageIds)
      startPosition = endPosition
      if (startPosition < packageSize) {
        await sleep(1000)
      }
    }
  } catch (error) {
    logger.error(error)
  }
  return packagesUploaded
}

function logPackageIds (pkgs) {
  let pos = 0
  do {
    let idBatch = pkgs.slice(pos, pos + 100)
    logger.log('*** updated packages :', idBatch, '*** total: ', idBatch.length)
    pos += 100
  } while (pos < pkgs.length)
}

async function processPackagesBatch (dbAccessor, packages, warehouseKey, warehouseName, warehouseSite, siteName, isQuantityReverse = false) {
  let currentTime = new Date()
  let packagesUploaded = []
  let packageIds = []
  packages.forEach((pkg, index) => {
    packagesUploaded[index] = 0   // initialize return array
    pkg.index = index  // record pkg position
  })
  const isCustom = packages[0].size === 'custom'
  if (!packages || packages.length === 0) return Promise.resolve('nothing to process')
  let inventorySumMap = groupPackagesByTenantKeyAndUpc(packages, 
    isQuantityReverse, 
    warehouseKey, 
    warehouseName, 
    warehouseSite, 
    siteName)

  let updatePromises = Object.keys(inventorySumMap).map(organizationKey => {
    if (organizationKey === 'no-org') {
      return updateNoOrgPackages(dbAccessor, inventorySumMap[organizationKey], organizationKey, packagesUploaded)
    } else {
      return updateOrgPackages (dbAccessor, 
        inventorySumMap, 
        warehouseSite, 
        organizationKey, 
        currentTime, 
        packagesUploaded, 
        warehouseKey, 
        isCustom)
    }
  })
  let newPackagesArray = await Promise.all(updatePromises)
  packageIds = flatArray(newPackagesArray)
  return {packageBatchUploaded: packagesUploaded, packageIds}
}

function groupPackagesByTenantKeyAndUpc (packages, isQuantityReverse, warehouseKey, warehouseName, warehouseSite, siteName) {
  let sum = {}
  packages.forEach(pkg => {
    let {upc, organizationKey, quantity, isAbnormal = false} = pkg
    if (!organizationKey) { organizationKey = 'no-org' }

    pkg.isAddedToInventory = false
    if (!sum[organizationKey]) {
      sum[organizationKey] = {}
    }
    if (!sum[organizationKey][upc]) {
      sum[organizationKey][upc] = {
        abnormalPkgTotalQty: 0,
        quantity: 0,
        warehouseSite: '',
        siteName: '',
        warehouseKey: '',
        packages: []
      }
    }

    // all the abnormal package products' qty will be addad to inventory after this abnormal case has been resolved.
    // so add all qty to abnormal distribution

    sum[organizationKey][upc].abnormalPkgTotalQty = sum[organizationKey][upc].abnormalPkgTotalQty + quantity * isAbnormal
    sum[organizationKey][upc].quantity = (sum[organizationKey][upc].quantity + !isAbnormal * (isQuantityReverse ? -1 : 1) * quantity)
    sum[organizationKey][upc].warehouseSite = pkg.warehouseSite || warehouseSite
    sum[organizationKey][upc].siteName = pkg.siteName || siteName
    sum[organizationKey][upc].warehouseName = warehouseName
    sum[organizationKey][upc].warehouseKey = warehouseKey
    sum[organizationKey][upc].packages.push(pkg)
    let month = pkg.createTime.getMonth()
    sum[organizationKey][upc].month = month
  })
  return sum
}

function updateNoOrgPackages (dbAccessor, upc2PackagesMap, organizationKey, packagesUploaded) {
  let batch = dbAccessor.batch()
  let packageIds = []
  Object.values(upc2PackagesMap).forEach(({packages, warehouseKey}) => {
    packages.forEach(pkg => {
      if (!pkg.ref) {
        // add new package to db
        let newDocRef = dbAccessor.getNewDocumentKey('warehouses', warehouseKey, 'packages')
        packageIds.push(newDocRef.id)
        batch.set(newDocRef, {...pkg, isAddedToInventory: false})
      }
    })
  })

  return batch.commit()
    .then(() => {
      Object.values(upc2PackagesMap).forEach(({packages}) => {
        packages.forEach(pkg => {
          packagesUploaded[pkg.index] = 1
        })
      })
      return packageIds
    })
    .catch((error) => {
      logger.error({error: error.message, organizationKey})
      return []
    })
}

async function updateOrgPackages (dbAccessor, inventorySumMap, warehouseSite, organizationKey, currentTime, packagesUploaded, warehouseKey, isCustom) {
  let upc2RefMap = await buildUpc2RefMap(inventorySumMap, organizationKey, dbAccessor)
  let packageIds = []
  return dbAccessor.updateInTransaction(async transaction => {
    let warehouseInventoryKey = `${warehouseSite}_${organizationKey}`
    let warehouseInventoryDoc = await transaction.get(dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'inventory', warehouseInventoryKey]))
    let productDocArray = await Promise.all(
      Object.keys(inventorySumMap[organizationKey])
        .filter(upc => upc2RefMap[upc])
        .map(upc => transaction.get(upc2RefMap[upc])))
    let upc2ProductDocMap = new Map(productDocArray.map(doc => {
      let {upc} = doc.data()
      if (!doc.ref.isEqual(upc2RefMap[upc])) throw Error('tenant-upc-changed')
      return [upc, doc]
    }))
    let inventory = warehouseInventoryDoc.data() || {}

    Object.keys(inventorySumMap[organizationKey]).forEach(upc => {
      let pkgIdsForUpc = []
      let change = inventorySumMap[organizationKey][upc]
      if (!upc2ProductDocMap.has(upc)) {
        // This is for packages cant link to any tenant product.
        // For processPackages calling, we dont update anything.
        if (change.packages[0].ref) return
        updateWarehouseInventory(inventory, change, upc)
        pkgIdsForUpc = addOrUpdatePackages(dbAccessor, transaction, change, currentTime, false)
      } else {
        let productDoc = upc2ProductDocMap.get(upc)
        // this is for packages that can link to an existed upc
        updateOrganizationInventory(transaction, productDoc, change, isCustom, organizationKey)
        pkgIdsForUpc = addOrUpdatePackages(dbAccessor, transaction, change, currentTime, true)

        // for processPackages calling, warehouse inventory has already been updated once before
        if (!change.packages[0].ref) {
          updateWarehouseInventory(inventory, change, upc)
        }
      }
      packageIds = [...packageIds, ...pkgIdsForUpc]
    })
    if (warehouseSite !== organizationKey) {
      if (warehouseInventoryDoc.exists) transaction.set(warehouseInventoryDoc.ref, dbAccessor.addUpdateDocTimestamp(inventory))
      else transaction.set(warehouseInventoryDoc.ref, dbAccessor.addNewDocTimestamp(inventory))
    } 
  })
    .then(() => {
      Object.keys(inventorySumMap[organizationKey]).forEach(upc => {
        inventorySumMap[organizationKey][upc].packages.forEach(pkg => {
          packagesUploaded[pkg.index] = 1
        })
      })
      return packageIds
    })
    .catch((error) => {
      logger.error({error: error.message, organizationKey})
      return []
    })
}

async function buildUpc2RefMap (inventorySumMap, organizationKey, dbAccessor) {
  let upc2RefMap = {}
  let organizationInventoryDocsArray = await Promise.all(Object.keys(inventorySumMap[organizationKey]).map(upc => {
    return dbAccessor.queryWithPredicates([{field: `upc`, compare: '==', value: upc}], 'tenants', organizationKey, 'inventory')
  }))
  organizationInventoryDocsArray.forEach(docs => {
    if (docs.size > 0) {
      let {upc} = docs.docs[0].data()
      upc2RefMap[upc] = docs.docs[0].ref
    }
  })
  return upc2RefMap
}

function updateOrganizationInventory (transaction, doc, change, isCustom, organizationKey) {
  let product = doc.data()
  let productId = doc.id
  let addressEncode = change.warehouseSite === organizationKey ? `warehouse${productId}${Buffer.from(change.siteName).toString('base64')}` : `warehouse${productId}${change.warehouseSite}`
  let distribution = product.distribution ? product.distribution : {}

  let oldValue = (distribution[addressEncode] && distribution[addressEncode].quantity) || 0
  distribution[addressEncode] = change.warehouseSite === organizationKey ? {
    uid: organizationKey,
    userName: 'self',
    warehouseSite: `self-${change.siteName}`,
    siteName: change.siteName,
    quantity: oldValue + change.quantity
  } : {
    uid: change.warehouseKey,
    userName: change.warehouseName,
    warehouseSite: change.warehouseSite,
    siteName: change.siteName || change.warehouseSite,
    quantity: oldValue + change.quantity,
    warehouseKey: change.warehouseKey,
    isCustom
  }
  let quantity = product['quantity'] ? product['quantity'] + change.quantity : change.quantity
  let inbound = product['inbound'] ? product['inbound'] + change.quantity : change.quantity
  let newValue = {
    distribution,
    quantity,
    inbound
  }
  transaction.update(doc.ref, newValue)
}

function updateWarehouseInventory (inventory, change, upc) {
  if (JSON.stringify(inventory) !== '{}') {
    let {distribution, abnormalDistribution} = inventory
    if (change.quantity) {
      if (distribution) {
        distribution[upc] = change.quantity + (distribution[upc] || 0)
      } else {
        inventory.distribution = { [upc]: change.quantity }
      } 
    }
    if (change.abnormalPkgTotalQty) {
      if (abnormalDistribution) {
        abnormalDistribution[upc] = change.abnormalPkgTotalQty + (abnormalDistribution[upc] || 0)
      } else {
        inventory.abnormalDistribution = { [upc]: change.abnormalPkgTotalQty }
      }
    }
    if (inventory.distribution && Object.keys(inventory.distribution).length >= 3000) throw Error('distribution-size-exceed')
  } else {
    Object.assign(inventory, {
      tenantKey: change.packages[0].organizationKey,
      siteKey: change.warehouseSite
    })
    updateWarehouseInventory(inventory, change, upc)
  }
}

function addOrUpdatePackages (dbAccessor, transaction, change, currentTime, isAddedToInventory) {
  let packageIds = []
  change.packages.forEach(pkg => {
    if (pkg.ref) {
      packageIds.push(pkg.ref.id)
      isAddedToInventory && !pkg.isAbnormal && transaction.update(pkg.ref, {addedToInventoryTime: currentTime, isAddedToInventory})
    } else {
      let payload = {...pkg, isAddedToInventory: (isAddedToInventory && !pkg.isAbnormal) }
      payload.isAddedToInventory && (payload.addedToInventoryTime = currentTime)
      delete payload.index
      let newPkgDoc = dbAccessor.getNewDocumentKey('warehouses', change.warehouseKey, 'packages')
      packageIds.push(newPkgDoc.id)
      transaction.set(newPkgDoc, payload)
    }
  })
  return packageIds
}

async function updateWarehouseFeeInbound (warehouseKey, items, dbAccessor, note, workerKey, workerName) {
  if (!items.length) return
  let itemsHasOrganizationKey = items.filter(item => item.organizationKey)
  let tenant2PackagesMap = groupPackagesByOrganizationKeys(itemsHasOrganizationKey)
  let updateBalanceMap = new Map()
  const isCustom = items[0].size === 'custom'
  if (isCustom) {
    tenant2PackagesMap.forEach((items, organizationKey) => {
      let {transactionLog, balanceDiff} = calculateCustomFeeAndGenerateLog(items, warehouseKey, organizationKey, workerKey, workerName)
      updateBalanceMap.set(`${warehouseKey}_${organizationKey}`, {balanceDiff, transactionLog})
    })
    return updateWarehouseBalanceByInbound(updateBalanceMap, warehouseKey, dbAccessor)
  }
  let tenant2DiscountMap = new Map()
  let discountDocs = await Promise.all([...tenant2PackagesMap]
    .map(([organizationKey, items]) => dbAccessor.query('warehouses', warehouseKey, 'organizations', organizationKey)))
  discountDocs.forEach(discountDoc => {
    if (discountDoc.exists) {
      let {discountRate = 0, isInboundWaived = false} = discountDoc.data()
      let tenantKey = discountDoc.id
      tenant2DiscountMap.set(tenantKey, isInboundWaived ? 100 : discountRate)
    }
  })

  let warehouseDoc = await dbAccessor.query('warehouseLimitedInfo', warehouseKey)
  const {rates} = warehouseDoc.data()
  if (!rates) {
    logger.log('Fee is not defined. Skip billing.')
    return Promise.resolve('success')
  }
  const {packageRates, unitRates} = rates
  const inPackageFee = packageRates.inbound
  const size2RateMap = new Map([
    ...unitRates.map(item => [item.name, item.inbound]),
    ...unitRates.map(item => [item.sortKey, item.inbound])
  ])
  tenant2PackagesMap.forEach((items, organizationKey) => {
    let discountRate = tenant2DiscountMap.get(organizationKey)
    let {transactionLog, balanceDiff} = calculateWarehouseFeeAndGenerateLog(size2RateMap, 
      inPackageFee, 
      discountRate, 
      items, 
      warehouseKey, 
      organizationKey,
      note,
      workerKey,
      workerName)
    updateBalanceMap.set(`${warehouseKey}_${organizationKey}`, {balanceDiff, transactionLog})
  })

  return updateWarehouseBalanceByInbound(updateBalanceMap, warehouseKey, dbAccessor)
}

// For all organizations
function groupPackagesByOrganizationKeys (items) {
  let tenant2PackagesMap = new Map()
  items.forEach(item => {
    let {organizationKey} = item
    if (tenant2PackagesMap.has(organizationKey)) {
      let newVal = tenant2PackagesMap.get(organizationKey)
      newVal.push(item)
      tenant2PackagesMap.set(organizationKey, newVal)
    } else {
      tenant2PackagesMap.set(organizationKey, [item])
    }
  })
  return tenant2PackagesMap
}

// For one organizaiton
function calculateWarehouseFeeAndGenerateLog (size2RateMap, packageFee = 0, discountRate = 0, items, warehouseKey, organizationKey, note, workerKey, workerName) {
  let balanceDiff = 0
  let trackingSet = new Set()
  let itemsLog = items.map(item => {
    let {trackings, upc, quantity, size, sku = ''} = item
    balanceDiff += size2RateMap.get(size) * quantity
    
    trackingSet.add(trackings.join('_').toUpperCase())
    return {trackings, upc, sku, quantity, unitFee: size2RateMap.get(size)}
  })
  let packageQty = trackingSet.size

  let packageCost = packageQty * (packageFee || 0)
  balanceDiff = toMoney((packageCost + balanceDiff) * (1 - discountRate / 100))
  let transactionLog = {
    items: itemsLog, 
    packageFee, 
    discountRate, 
    packageQty, 
    warehouseKey, 
    tenantKey: organizationKey, 
    transactionType: 'fee', 
    subtype: 'inbound',
    workerKey,
    workerName
  }
  note && (transactionLog.note = note)
  return {transactionLog, balanceDiff}
}

function calculateCustomFeeAndGenerateLog (items, warehouseKey, organizationKey, workerKey, workerName) {
  let balanceDiff = 0

  let itemsLog = items.map(item => {
    let {trackings, upc, quantity, unitFee} = item
    balanceDiff += quantity * unitFee // this quantity = (normal + abnormal)
    return {trackings, upc, quantity, unitFee}
  })

  let transactionLog = {
    items: itemsLog, 
    warehouseKey, 
    tenantKey: organizationKey, 
    transactionType: 'fee', 
    subtype: 'inbound', 
    note: 'custom',
    workerKey,
    workerName
  }
  return {transactionLog, balanceDiff: toMoney(balanceDiff)}
}

// Between one warehouse and one organization
function updateWarehouseBalanceByInbound (updateBalanceMap, warehouseKey, dbAccessor) {
  return dbAccessor.updateInTransaction(async transaction => {
    let transactionRef = dbAccessor.buildStoreQuery(['warehouseTransactions'])
    let getPromises = [...updateBalanceMap].map(([key, val]) => transaction.get(dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'billings', key])))
    let billingDocs = await Promise.all(getPromises)
    billingDocs.forEach((billingDoc, index) => {
      let {balanceDiff, transactionLog} = [...updateBalanceMap.values()][index]
      // if balance is abnormal, transaciton ends here without update
      if (balanceDiff === 0) return
      if (!balanceDiff) throw Error('abnormal-balance') 
      let newBalance
      if (billingDoc.exists) {
        let {balance=0, expenseHistory=[]} = billingDoc.data()
        
        let history = new ExpenseHistory(expenseHistory)
        expenseHistory = history.addExpense(balanceDiff)

        newBalance = addNumbers((balance || 0), -balanceDiff)
        let billingUpdate = {balance: newBalance, expenseHistory}
        transaction.update(billingDoc.ref, dbAccessor.addUpdateDocTimestamp(billingUpdate))
      } else {
        newBalance = -balanceDiff

        let history = new ExpenseHistory()
        let expenseHistory = history.addExpense(balanceDiff)

        transaction.set(billingDoc.ref, dbAccessor.addNewDocTimestamp({
          tenantKey: [...updateBalanceMap.keys()][index].split('_')[1],
          balance: newBalance,
          expenseHistory
        }))
      }
      transaction.set(transactionRef.doc(), dbAccessor.addNewDocTimestamp({...transactionLog, amount: -balanceDiff, newBalance}))
    })
  })
}

/**
 * calculate the fee of warehouse's shipment outbound service 
 * @param {firestoreTransaction} transaction 
 * @param {dbAccessor} dbAccessor 
 * @param {string} warehouseKey 
 * @param {string} tenantKey 
 * @param {object} rates 
 * @param {calculateOtherServicesFee} otherServicesCalResult 
 * @param {number} discountRate 
 * @param {object} products 
 * @param {number} packageQty 
 * @param {firestoreDoc} balanceDoc 
 */
function calculateOutboundWarehouseFee (transaction, 
  dbAccessor, 
  warehouseKey, 
  tenantKey, 
  rates, 
  otherServicesCalResult, 
  discountRate = 0, 
  products, 
  packageQty, 
  balanceDoc, 
  upc2Size,
  workerKey,
  workerName) {
  if (!rates) {
    logger.log('Fee is not defined. Skip billing.')
    return 
  }
  const {packageRates, unitRates} = rates
  const outPackageFee = packageRates.outbound
  const size2RateMap = new Map([
    ...unitRates.map(item => [item.name, item.outbound]),
    ...unitRates.map(item => [item.sortKey, item.outbound]),
    ['custom', 0]
  ])
  let balanceDiff = 0
  let productsLog = products.map(product => {
    let {toShip, upc} = product
    const size = upc2Size.get(upc)
    balanceDiff += toShip * size2RateMap.get(size)
    return {quantity: toShip, upc, unitFee: size2RateMap.get(size)}
  })

  balanceDiff += packageQty * (outPackageFee || 0) + otherServicesCalResult.fee
  balanceDiff *= 1 - discountRate / 100

  if (!balanceDiff) return

  let newBalance
  if (balanceDoc.exists) {
    let {balance=0, expenseHistory=[]} = balanceDoc.data()
    newBalance = addNumbers(balance || 0, -balanceDiff)
  
    let history = new ExpenseHistory(expenseHistory)
    expenseHistory = history.addExpense(balanceDiff)

    transaction.update(balanceDoc.ref, {balance: newBalance, expenseHistory})
  } else {
    newBalance = -balanceDiff
    let history = new ExpenseHistory()
    let expenseHistory = history.addExpense(balanceDiff)

    transaction.set(balanceDoc.ref, dbAccessor.addNewDocTimestamp({
      balance: -toMoney(balanceDiff), 
      expenseHistory, 
      tenantKey
    }))
  }

  let transactionLog = { 
    newBalance: toMoney(newBalance), 
    amount: -toMoney(balanceDiff), 
    products: productsLog, 
    packageFee: outPackageFee,
    discountRate, 
    warehouseKey, 
    tenantKey, 
    packageQty,
    transactionType: 'fee', 
    subtype: 'outbound',
    otherServices: otherServicesCalResult.otherServices,
    otherServicesFee: otherServicesCalResult.fee,
    warehouseNote: otherServicesCalResult.warehouseNote,
    workerKey,
    workerName
  }
  transaction.set(dbAccessor.getNewDocumentKey('warehouseTransactions'), dbAccessor.addNewDocTimestamp(transactionLog))
}

/**
 * calculated other services fee of one shipment without photo fee 
 * @param {Map<string, string>} upc2Size warehouse's upc to product's size
 * @param {OtherRates} otherRates from warehouse's fee setting page
 * @param {Array<string>} confirmedOtherServices service items set of ['expedited', 'photo', 'label', 'SN', 'otherAdditionsFee']
 * @param {Array<object>} products from payload
 * @param {Number} packageQty  
 * @param {Number} adjustOtherServicesFee adjust Customize services fee
 * @param {String} warehouseNote
 * 
 * @returns {{otherServices: Array<string>, fee: number, warehouseNote: string}} 
 * 
 * @author Elbert Chen<elbert.chen@viteusa.com>
 * @created 2019-10-17
 */
function calculateOtherServicesFee (upc2Size, otherRates, confirmedOtherServices, products, packageQty, adjustOtherServicesFee = 0, warehouseNote = '') {
  let result = { otherServices: [], fee: 0, warehouseNote }
  otherRates = otherRatesChecker(otherRates)
  if (confirmedOtherServices.length > 0) {
    let serviceSelected = { expedite: 0, photo: 0, label: 0, SN: 0, extra: 0 }
    confirmedOtherServices.forEach(service => {serviceSelected[service] = 1})
    result.otherServices = confirmedOtherServices
    let countSize = {small: 0, medium: 0, large: 0}
    products.forEach(product => {
      let size = upc2Size.get(product.upc)
      // do not calculate other size fee
      const sizeMap = new Map([
        ['small', 'small'],
        ['medium', 'medium'],
        ['large', 'large'],
        [0, 'small'],
        [1, 'medium'],
        [2, 'large']
      ])
      if (sizeMap.has(size)) {
        result.fee += serviceSelected.label * product.toShip * otherRates[sizeMap.get(size) + 'ItemLabelFee'] +
          serviceSelected.SN * product.toShip * otherRates[sizeMap.get(size) + 'ItemSNFee']
        countSize[sizeMap.get(size)] += product.toShip
      } else if (size !== 'custom') {
        result.fee += serviceSelected.label * product.toShip * otherRates['largeItemLabelFee'] +
        serviceSelected.SN * product.toShip * otherRates['largeItemSNFee']
        countSize['large'] += product.toShip
      }
    })

    // add other addtions fee
    result.fee += serviceSelected.extra * adjustOtherServicesFee

    // add expedite fee
    result.fee += serviceSelected.expedite * packageQty * otherRates['expeditePackageFee']

    // photo fee
    result.fee = toMoney( serviceSelected.photo * (
        Math.ceil(countSize.large / otherRates.largeItemPhotoQuantity) * otherRates.largeItemPhotoFee +
        Math.ceil(countSize.medium / otherRates.mediumItemPhotoQuantity) * otherRates.mediumItemPhotoFee +
        Math.ceil(countSize.small / otherRates.smallItemPhotoQuantity) * otherRates.smallItemPhotoFee
      ) + result.fee )
  }
  return result
}

/**
 * From EZW-432 model design
 * @typedef {Object<string, number>} OtherRates
 * @property {number} expeditePackageFee
 * @property {number} smallItemLabelFee
 * @property {number} mediumItemLabelFee
 * @property {number} largeItemLabelFee
 * @property {number} smallItemPhotoFee
 * @property {number} smallItemPhotoQuantity >= 1
 * @property {number} mediumItemPhotoFee
 * @property {number} mediumItemPhotoQuantity >= 1
 * @property {number} largeItemPhotoFee
 * @property {number} largeItemPhotoQuantity >= 1
 * @property {number} smallItemSNFee
 * @property {number} mediumItemSNFee
 * @property {number} largeItemSNFee
 */

/**
 * checked and build default otherRates
 * @param {object} otherRates 
 * @param {number} setValue if no set, set default value = 0
 * @returns {OtherRates}
 */
function otherRatesChecker (otherRates = {}, setValue = 0) {
  if (typeof otherRates !== 'object') otherRates = {}
  let resOtherRates = {...otherRates}
  let keys = [  // Other rates properties group
    'expeditePackageFee',
    'smallItemLabelFee', 'mediumItemLabelFee', 'largeItemLabelFee', 
    'smallItemPhotoFee', 'mediumItemPhotoFee', 'largeItemPhotoFee', 
    'smallItemPhotoQuantity', 'mediumItemPhotoQuantity', 'largeItemPhotoQuantity', 
    'smallItemSNFee', 'mediumItemSNFee', 'largeItemSNFee'
  ]
  keys.forEach(key => {
    resOtherRates[key] = (key in otherRates) ? resOtherRates[key] : setValue
  })
  resOtherRates.smallItemPhotoQuantity > 0 || (resOtherRates.smallItemPhotoQuantity = 1)
  resOtherRates.mediumItemPhotoQuantity > 0 || (resOtherRates.mediumItemPhotoQuantity = 1)
  resOtherRates.largeItemPhotoQuantity > 0 || (resOtherRates.largeItemPhotoQuantity = 1)
  return resOtherRates
}

export {
  updateInventoryPromise, updateWarehouseFeeInbound, calculateOutboundWarehouseFee, 
  calculateOtherServicesFee, logPackageIds
}
