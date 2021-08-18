import {updateInventoryPromise, updateWarehouseFeeInbound} from './warehouseHelper'
import zip from 'lzutf8'
import { WarehouseStat } from '../utils/tools'

async function updatePrescanHistory (trackingSet, activeWarehouse, dbAccessor) {
	const tempSet = new Set(trackingSet)
	for (const tracking of tempSet) {
		const predicates = [{
			field: `trackings`,
			compare: 'array-contains',
			value: tracking.toUpperCase()
		}]
		const docs = await dbAccessor.queryWithPredicates(predicates, 'warehouses', activeWarehouse, 'scannedTrackings')
		if (docs.size > 0) {
			let doc
			if (docs.size === 1) {
				doc = docs.docs[0]
			} else {
				doc = docs.docs.find(doc => doc.data().type === 'inbound')
				if (!doc) {
					doc = docs.docs[0]
				}
			}
			const {trackings = [], uploadedTrackings = []} = doc.data()
			const docTrackingSet = new Set(trackings)
			const allTrackingsToUpdate = [...tempSet]
			const newTrackings = allTrackingsToUpdate.filter(item => docTrackingSet.has(item)) // remove other tracking to save read
			const newUploadedTrackings = [...new Set([...uploadedTrackings, ...newTrackings])]
			newTrackings.forEach(tracking => {
				tempSet.delete(tracking)
			})
			if (newUploadedTrackings.length !== uploadedTrackings.length) {
				await doc.ref.update({uploadedTrackings: newUploadedTrackings})
			}
		}
	}
	return ('success')
}

async function updateInboundTrackingCache (itemsUploaded, activeWarehouse, dbAccessor) {
	const configDoc = await dbAccessor.query('sysAdmin', 'inboundConfig')
	const {updatePrescanHistory: activeWarehouseSet = []} = configDoc.data() || {}
	const newTrackingSet = new Set(itemsUploaded.map(item => item.trackings[0]))
	await dbAccessor.updateInTransaction(async transaction => {
		const cacheDoc = await transaction.get(dbAccessor.buildStoreQuery(['warehouses', activeWarehouse, 'uploadHistory', 'inboundTrackingCache']))
		if (!cacheDoc.exists) {
			transaction.set(cacheDoc.ref, {trackings: [...newTrackingSet]})
		} else {
			let {trackings = []} = cacheDoc.data()
			transaction.set(cacheDoc.ref, {trackings: [...newTrackingSet, ...trackings].slice(0, 10000)})
		}
	})
	if (!activeWarehouseSet.includes(activeWarehouse)) return 'skip'

	await updatePrescanHistory(newTrackingSet, activeWarehouse, dbAccessor)
	return 'success'
}

function convertTrackings (trackings) {
	return trackings.reduce((acc, tracking) => {
		if (!Array.isArray(tracking.barcode)) throw Error('Invalid-item-barcode-format')
		return [...acc, ...tracking.barcode]
	}, [])
}

class DuplicateRequestError extends Error {
	constructor(status, uploadedFlags) {
			super('duplicate-upload-request')
			this.code = 'duplicate-upload-request'
			this.status = status
			this.uploadedFlags = uploadedFlags
	}

	get isDuplicate () {
		return true
	}
}

// request format: {createTime, uploadRequestId, status, uploadedFlags}
async function lockAndUpdateInventory (createTime, data, items, dbAccessor) {
	let {uploadRequestId, activeWarehouse, warehouseName, warehouseSite, siteName} = data
	let uploadedFlags = []
	// lock
	logger.log('try locking the uploadRequestId: ', uploadRequestId)
	await dbAccessor.updateInTransaction(async transaction => {
		const doc = await transaction.get(dbAccessor.buildStoreQuery(['warehouses', activeWarehouse, 'uploadHistory', warehouseSite]))
		let historyData = doc.exists ? doc.data() : {}
		let requests = historyData.requests || []
		let thisRequest = requests.find( request => request.uploadRequestId === uploadRequestId)
		if (thisRequest && ['in-progress', 'done'].includes(thisRequest.status)) {
			throw new DuplicateRequestError(thisRequest.status, thisRequest.uploadedFlags || []) 
		}
		const allTrackings = items.reduce( (accum, anItem) => {
			return accum ? accum + ',' + anItem.trackings[0] : anItem.trackings[0]
		}, '')
		const trackingZip = zip.compress(allTrackings, {outputEncoding: 'StorageBinaryString'})
		thisRequest = {createTime, uploadRequestId, status: 'in-progress', trackingZip, uploadedFlags: []}
		requests.push(thisRequest)
		if (requests.length > 50) requests.shift()
		transaction.set(doc.ref, {...historyData, requests})
	})

		// update inventory
	logger.log('proceed update inventory')
	uploadedFlags = await updateInventoryPromise(dbAccessor, items, activeWarehouse, warehouseName, warehouseSite, siteName)

	// unlock
	logger.log('unlock uploadRequestId: ', uploadRequestId)
	await dbAccessor.updateInTransaction(async transaction => {
		const doc = await transaction.get(dbAccessor.buildStoreQuery(['warehouses', activeWarehouse, 'uploadHistory', warehouseSite]))
		if (!doc.exists) logger.error('lock-file-missing')
		let historyData = doc.data() || {}
		let requests = historyData.requests || []
		let thisRequest = requests.find( request => request.uploadRequestId === uploadRequestId)
		if (!thisRequest) logger.error('upload-request-id-missing')
		thisRequest.status = 'done' //keep the same object
		thisRequest.uploadedFlags = uploadedFlags
		transaction.set(doc.ref, {...historyData, requests})
	})

	return uploadedFlags
}

async function updateWarehouseStat (itemsUploaded, warehouseKey, warehouseSite, dbAccessor, workerKey, workerName) {
	try {
		let items = itemsUploaded.length
		let units = 0
		let trackingSet = new Set()
		itemsUploaded.forEach(item => {
			let {trackings, quantity} = item
			trackingSet.add(trackings[0])
			units += quantity
		})

		await dbAccessor.updateInTransaction(async transaction => {
			const doc = await transaction.get(dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'statistics', `${warehouseSite}_inbound`]))
			let warehouseStat = new WarehouseStat(doc.data())
			warehouseStat.addStatByProducts({units, packages: trackingSet.size, items}, workerKey, workerName)
			
			transaction.set(doc.ref, {...warehouseStat.getData(), warehouseSite, warehouseKey, type: 'inbound'})
		})
	} catch(ex) {
		logger.error('update statistic failed. ', ex, itemsUploaded)
	}
	
	return 'finished'
}
async function updateDailyInbound (itemsUploaded, warehouseKey, warehouseSite, dbAccessor, workerKey, workerName) {
	try {
		const currentTime = new Date()
		const curMonthKeyStr = `${currentTime.getFullYear()}-${(currentTime.getMonth() + 1).toString().padStart(2, '0')}`
    const curDateKeyStr = `${curMonthKeyStr}-${currentTime.getDate().toString().padStart(2, '0')}`

		await dbAccessor.updateInTransaction(async transaction => {
			const doc = await transaction.get(dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'sites', warehouseSite, 'dailyInbound', curDateKeyStr]))
			let {upcToQtyMapArray = []} = doc.data() || {}
			let upcToQtyMap = new Map(upcToQtyMapArray.map(({key, value}) => [key, value]))
			itemsUploaded.forEach(item => {
				let {upc, quantity} = item
				!upcToQtyMap.has(upc) && (upcToQtyMap.set(upc, {totalQty: 0, unstowedQty: 0}))
				upcToQtyMap.get(upc).totalQty += quantity
				upcToQtyMap.get(upc).unstowedQty += quantity
			})

			if (doc.exists) {
				transaction.update(doc.ref, {
					upcToQtyMapArray: [...upcToQtyMap].map(([key, value]) => { return {key, value} }),
					keywords: [...upcToQtyMap].map(([key, value]) => key)
				})
			} else {
				transaction.set(doc.ref, {
					upcToQtyMapArray: [...upcToQtyMap].map(([key, value]) => { return {key, value} }),
					keywords: [...upcToQtyMap].map(([key, value]) => key)
				})
			}
		})
	} catch(ex) {
		logger.error('update daily inbound failed. ', ex, itemsUploaded)
	}
	
	return 'finished'
}

// this is to process unlinked packages per tenant after a product UPC is added or updated
export default async function uploadPackages(data, context) {
	let {db, dbAccessor} = context.appContext
	let {uploadRequestId, items, activeWarehouse, warehouseName, warehouseSite, siteName, workerKey, workerName} = data
	if (!items || !warehouseSite || !uploadRequestId) return Promise.reject(Error('data missing'))

	try {
		if (items && items.length > 0) {
			let createTime = Date.now() + items.length
			items.forEach((element) => {
				Object.assign(element, {
					trackings: convertTrackings(element.trackings),
					isConfirmed: false,
					workerKey,
					workerName,
					warehouseSite,
					siteName,
					createTime: new Date(createTime)
				})
				createTime -= 1
			})

			let uploadedFlags = await lockAndUpdateInventory(createTime, data, items, dbAccessor)
			let itemsUploaded = items.filter((item, index) => uploadedFlags[index])

			await updateWarehouseStat(itemsUploaded, activeWarehouse, warehouseSite, dbAccessor, workerKey, workerName)
			await updateWarehouseFeeInbound(activeWarehouse, itemsUploaded, dbAccessor, '', workerKey, workerName)
			await updateDailyInbound(itemsUploaded, activeWarehouse, warehouseSite, dbAccessor)
			await updateInboundTrackingCache(itemsUploaded, activeWarehouse, dbAccessor)
			return {uploadedFlags, status: 'done'}
		}
	} catch (ex) {
		if (ex.isDuplicate) {
			logger.error ('duplicate upload request, ', ex)
			return { uploadedFlags: ex.uploadedFlags, status: ex.status}
		} else {
			logger.error('upload packages error', ex)
			throw ex
		}
	}			
}
