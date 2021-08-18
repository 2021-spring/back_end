import {updateInventoryPromise} from './warehouseHelper'

async function scanOneWarehouse(dbAccessor, warehouseKey, warehouseName, tenantKey, upc) {
	// retrieve packages
	let predicates = [
		{
			field: 'organizationKey',
			compare: '==',
			value: tenantKey
		},
		{
			field: 'upc',
			compare: '==',
			value: upc
		},
		{
			field: 'isAddedToInventory',
			compare: '==',
			value: false
		},
		{
			field: 'createTime',
			compare: '>',
			value: new Date('2000-01-01')
		}]
	let packageDocs = await dbAccessor.queryWithPredicates(predicates, 'warehouses', warehouseKey, 'packages')
	// need to seperate packages based on different site
	let packagesObj = {}
	packageDocs.forEach(doc => {
		let element = doc.data()
		element.ref = doc.ref
		element.createTime && (element.createTime = element.createTime.toDate())
		let {warehouseSite} = element
		if (!warehouseSite)	{
			warehouseSite = tenantKey
		}
		if (!packagesObj[warehouseSite]) packagesObj[warehouseSite] = []
		packagesObj[warehouseSite].push(element)
	})
	if (Object.keys(packagesObj).length > 0) {
		return await Promise.all(Object.keys(packagesObj).map(warehouseSite => {
			let packages = packagesObj[warehouseSite]
			if (packages && packages.length > 0) {
				// **********
				// update tenant inventory
				// **********
				return updateInventoryPromise(dbAccessor, packages, warehouseKey, warehouseName, warehouseSite || tenantKey)
			} else {
				return Promise.resolve('proceed')
			}
		}))
	}
	
	return 'success'
}

// this is to process unlinked packages per tenant after a product UPC is added or updated
export default async function processPackages(data, context) {
	let {db, dbAccessor} = context.appContext
	let {tenantKey, productId} = data
	logger.log('processPackages request: ', data)
	if (!tenantKey || !productId) return Promise.reject(Error('data missing'))
	
	// get product information
	let productDoc = await dbAccessor.query('tenants', tenantKey, 'inventory', productId)
	let product = productDoc.data()

	// get warehouse info
	// scan unlinked packages per warehouse, 
	// do with traditional, want to update one warheouse packages at a time
	let infoDoc = await dbAccessor.query('tenantLimitedInfo', tenantKey)
	let tenantLimitedInfo = infoDoc.data()
	let promises = []
	if (tenantLimitedInfo.warehouses) {
		for (let warehouse of tenantLimitedInfo.warehouses) {
			let {warehouseKey, warehouseName} = warehouse
			product.upc && promises.push(scanOneWarehouse(dbAccessor, warehouseKey, warehouseName, tenantKey, product.upc))
		}
	}

	// update user inventory 
	let { distribution, upc } = product
	for (let key in distribution) {
		if (key.slice(0, 9) === 'warehouse') continue

		let uid = distribution[key].uid
		if (!uid) continue
		// set update to promise array  
		promises.push(dbAccessor.updateFields({ upc }, 'userLimitedInfo', uid, 'inventory', `${tenantKey}_${productId}`))
	}

	return Promise.all(promises)
}