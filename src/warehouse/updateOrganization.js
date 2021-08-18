export default function updateOrganization(data, context) {
  let {id, warehouseKey, warehouseName, sites, organizationId = '', ...newObj} = data
	let {db, dbAccessor} = context.appContext
	let warehouseKeys = []
	let needToUpdateOfferTask = true
	let transaction = db.runTransaction(t => {
		return t.get(db.collection('tenantLimitedInfo').doc(id))
			.then(doc => {
				let warehouses = doc.data().warehouses
				let newWarehouse = {
					warehouseKey: warehouseKey,
					warehouseName: warehouseName,
					orgId: organizationId,
					sites: sites
				}
				let warehouseIndex = warehouses.findIndex((item) => {
						return item.warehouseKey === warehouseKey
        })
				if (warehouseIndex === -1) {
					warehouses.push(newWarehouse)
				} else {
					if (organizationId) {
						warehouses[warehouseIndex] = newWarehouse
						needToUpdateOfferTask = false
					} else {
						warehouses.splice(warehouseIndex, 1)
					}					
				}
				warehouseKeys = warehouses.map(item => item.warehouseKey)
				t.update(db.collection('tenantLimitedInfo').doc(id), dbAccessor.addUpdateDocTimestamp({warehouses: warehouses}))
				t.set(db.collection('warehouses').doc(warehouseKey).collection('organizations').doc(id), dbAccessor.addNewDocTimestamp({...newObj, organizationId}))
				t.update(db.collection('tenants').doc(id), dbAccessor.addUpdateDocTimestamp({organizationId: organizationId, warehouseKey: warehouseKey}))
				return
      })
	})

	return transaction
		// .then(() => {
		// 	if (!needToUpdateOfferTask) return Promise.resolve('done')
		// 		// update offers and tasks
		// 	let updateOffersPromisse = dbAccessor.queryWithPredicates([{field: 'tenantKey', compare: '==', value: id}], 'offers', 'offers', 'active')
		// 		.then(offerDocs => {
		// 			return Promise.all(offerDocs.docs.map(offerDoc => {
		// 				return dbAccessor.updateFields({warehouseKeys}, 'offers', 'offers', 'active', offerDoc.id)
		// 			}))
		// 		})
		// 	let updateTasksPromise = dbAccessor.queryWithPredicates([{field: 'tenantKey', compare: '==', value: id}], 'tasks', 'tasks', 'active')
		// 		.then(taskDocs => {
		// 			return Promise.all(taskDocs.docs.map(taskDoc => {
		// 				return dbAccessor.updateFields({warehouseKeys}, 'tasks', 'tasks', 'active', taskDoc.id)
		// 			}))
		// 		})
		// 	return Promise.all([updateOffersPromisse, updateTasksPromise])
		// })
}