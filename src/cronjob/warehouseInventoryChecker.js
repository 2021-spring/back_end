
export default async function warehouseInventoryChecker (data, context) {
  let { warehouseKey } = data
  let { dbAccessor } = context.appContext
  if (!warehouseKey) {
    logger.warn(`warehouseKey is undefined`)
    return `Error: need warehouseKey`
  }
  return checkWarehouseInventory(dbAccessor, warehouseKey)
}

async function checkWarehouseInventory (dbAccessor, warehouseKey) {
  let [
    warehouseInventoryDocs,
    relatedTenantsDocs,
    warehouseShipmentsDocs
  ] = await Promise.all([
    dbAccessor.query('warehouses', warehouseKey, 'inventory'),
    dbAccessor.query('warehouses', warehouseKey, 'organizations'),
    dbAccessor.queryWithPredicates([{field: 'warehouseKey', compare: '==', value: warehouseKey}],'shipments')
  ])

  let tenantInventoryDocsArray = await Promise.all(relatedTenantsDocs.docs.map(async ({id}) => {
    let predicates = [
      {field: 'quantity', compare: '>', value: 0}
    ]
    let docs = await dbAccessor.queryWithPredicates(predicates, 'tenants', id, 'inventory')
    return {tenantKey: id, snapshot: docs} 
  }))

  /** @type {Map<TenantKey, {WarehoustSite: {Upc: Number}}>} */
  let warehouseInventory = warehouseInventoryDocs
      .docs
      .reduce((preVal, doc) => {
        let {tenantKey, siteKey, distribution} = doc.data()
        let siteDistribution = preVal.get(tenantKey) || {}
        siteDistribution[siteKey] = distribution
        preVal.set(tenantKey, siteDistribution)
        return preVal
      }, new Map())

  /** @type {Map<String, {warehouseSite: {upc: Number}}>} */
  let warehouseShipments = warehouseShipmentsDocs
    .docs
    .reduce((preVal, curDoc) => {
      let {products, tenantKey} = curDoc.data() 
      let [{warehouseSite}] = products 
      let tenantShipmentUpcCollect = {}
      if (preVal.has(tenantKey)) tenantShipmentUpcCollect = preVal.get(tenantKey)
      let shipments = products.reduce((shipment, {upc, toShip}) => {
        if (upc) {
          if (!shipment[upc]) shipment[upc] = 0
          shipment[upc] += toShip
        }
        return shipment
      }, tenantShipmentUpcCollect[warehouseSite]||{})
      preVal.set(tenantKey, {...tenantShipmentUpcCollect, [warehouseSite]: shipments})
      return preVal
    }, new Map())
  
  // check
  let checkList = tenantInventoryDocsArray
    .map((tenantInventoryDocs) => { 
      let { tenantKey, snapshot} = tenantInventoryDocs
      /** @type {Map<upc, {warehouseSite: {quantity: Number, warehouseKey: String, warehouseSite: String}}>} */
      let tenantInventory = new Map(
        snapshot
          .docs
          .map(doc => {
            let {distribution, upc} = doc.data()
            return [upc, distribution]
          })
      )
      return checkWarehouseInventoryWithTenantInventory(warehouseKey, tenantKey, warehouseInventory.get(tenantKey), tenantInventory, warehouseShipments.get(tenantKey)||{})
    })
  return checkList
}

/**
 * 
 * @param {String} checkingWarehouseKey 
 * @param {String} tenantKey 
 * @param {Object} warehouseInventory 
 * @param {Map<String, Object>} tenantInventoryMap 
 * @param {Object} shipments 
 */
function checkWarehouseInventoryWithTenantInventory (checkingWarehouseKey, tenantKey, warehouseInventory = [], tenantInventoryMap = new Map(), shipments = {}) {
  // check warehouse Inventory distribution
  let okInfo = []
  let unlinks = []
  let warnResults = []
  let errInfo = Object.keys(warehouseInventory).reduce((checkSiteResults, warehouseSite) => {
    let warehouseSiteInventory = warehouseInventory[warehouseSite]
    let checkCurrentSiteResults = Object.keys(warehouseInventory[warehouseSite]).reduce((checkProductResults, upc) => {
      let qty = warehouseSiteInventory[upc] || 0
      let tenantRecord = tenantInventoryMap.get(upc)
      let checkingWarehouseSiteKey = warehouseSite

      /** @type {CheckErr} */
      let checkResult = {
        upc, 
        warehouseSite,
        warehouseQty: qty, 
        tenantRecordQty: 0,
        toShip: shipments[warehouseSite] && shipments[warehouseSite][upc] || 0,
        errMsg: ''
      }
      if (tenantRecord) {
        checkResult.tenantRecordQty = (Object.values(tenantRecord)
          .find(({warehouseSite}) => 
            warehouseSite === checkingWarehouseSiteKey
          ) || {quantity: 0}
        ).quantity
      } 
     
      let {tenantRecordQty, toShip} = checkResult
      let tenantQty = (tenantRecordQty + toShip)
      // check data
      if (qty !== tenantQty) {
        if (tenantRecord) {
          checkResult.errMsg += `Product's qty in warehouse does not match tenant's record & shipments`
        } else {
          unlinks.push({
            upc,
            warehouseKey: checkingWarehouseKey,
            warehouseSite: checkResult.warehouseSite,
            tenantKey
          })
        }
      }

      if (checkResult.errMsg.length > 0) {
        checkProductResults.push(checkResult)
      } else {
        delete checkResult.errMsg
        okInfo.push(checkResult)
      }
      return checkProductResults
    },[])
    return [...checkSiteResults, ...checkCurrentSiteResults]
  }, []) 

  // check related tenant Inventory
  tenantInventoryMap.forEach((siteDistribution, productUpc) => {
    if (productUpc.length === 0) return
    if (errInfo.find(({upc}) => productUpc === upc) || okInfo.find(({upc}) => productUpc === upc)) return 

    for (let site in siteDistribution) {
      let { quantity, warehouseSite, warehouseKey } = siteDistribution[site]
      if (warehouseKey !== checkingWarehouseKey) continue
      if (quantity === 0) {
        warnResults.push({
          upc: productUpc,
          warehouseKey,
          tenantKey,
          msg: 'unremove distribution'
        })
        continue
      }
      errInfo.push({
        upc: productUpc,
        warehouseQty: 0,
        tenantRecordQty: quantity,
        toship: shipments[warehouseSite] && shipments[warehouseSite][productUpc] || 0,
        errMsg: `Tenant has product's record, but warehouse has no record.`
      })
    }
  })

  /** @type {ErrorDoc} */
  return { 
    warehouseKey: checkingWarehouseKey, 
    tenantKey, 
    errInfo,
    unlinks,
    warnResults
  }
}
