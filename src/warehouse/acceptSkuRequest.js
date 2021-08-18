export default async function acceptSkuRequest(data, context) {
	let {db, dbAccessor} = context.appContext
  let {sku, note, upc, warehouseKey, warehouseName, tenantKey, key} = data
  
  // const skuRef = dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'upcs', `${tenantKey}_${sku}`])
  const warehouseUpcDocs = await dbAccessor.queryWithPredicates([{
    field: `upc`,
    compare: '==',
    value: upc
  }], 'warehouses', warehouseKey, 'upcs')
  const tenantInventoryDocs = await dbAccessor.queryWithPredicates([{
    field: `upc`,
    compare: '==',
    value: upc
  }], 'tenants', tenantKey, 'inventory')
  if (tenantInventoryDocs.size === 0) throw Error('tenant-inventory-missing')
  if (warehouseUpcDocs.size === 0) throw Error('warehouse-upc-missing')
  return dbAccessor.updateInTransaction(async transaction => {
    const warehouseUpcDoc = await transaction.get(warehouseUpcDocs.docs[0].ref)
    const tenantInventoryDoc = await transaction.get(tenantInventoryDocs.docs[0].ref)

    // const skuDoc = await transaction.get(skuRef)
    const {approvedSkus: warehouseNewSkus = []} = warehouseUpcDoc.data()
    let warehouseNewSkuSet = new Set(warehouseNewSkus)
    warehouseNewSkuSet.add(`${tenantKey}_${sku}`)
    const {approvedSkus: tenantNewSkus = []} = tenantInventoryDoc.data()
    let tenantNewSkuSet = new Set(tenantNewSkus)
    tenantNewSkuSet.add(`${warehouseKey}_${sku}`)
    transaction.update(warehouseUpcDoc.ref, dbAccessor.addUpdateDocTimestamp({ approvedSkus: [...warehouseNewSkuSet] }))
    transaction.update(tenantInventoryDoc.ref, dbAccessor.addUpdateDocTimestamp({ approvedSkus:  [...tenantNewSkuSet] }))
    // transaction.delete(skuDoc.ref)
    transaction.delete(dbAccessor.buildStoreQuery(['skuRequests', key]))
  })
}