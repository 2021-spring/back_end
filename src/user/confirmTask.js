import {addNumbers, splitProductName} from '../utils/tools'
import moment from 'moment'

export default async function confirmTask (data, context) {
  data.isConfirmed = true
  let {dbAccessor, db} = context.appContext
  const {uid, token = {}} = context.auth
  let {tenantKey, userKey, productId, taskKey, createTime, warehouse} = data

  if (new Date(createTime) < moment(new Date()).subtract(45, 'days').toDate() && warehouse === 'self') {
    throw Error('(Past Due) Cannot confirm this task. Please contact support.')
  }

  // handle ping here
  if (data.ping) {
    logger.log('receive ping to: ', 'confirmTask', uid)
    return dbAccessor.queryFirst(['balance'])
      .then(doc =>{
        return 'waking up: ' + new Date().toTimeString()
      })
  } 
  
  // TODO: validate input

  if (data.warehouse === 'warehouse' && (!data.packages || !Array.isArray(data.packages))) throw Error('Please update to new version of webapp UI')
  if (!data.pendingPeriod && data.pendingPeriod !== 0) throw Error('Missing pending period.')
  let balanceKey = `${tenantKey}_${userKey}`

  // first get the upc information
  return dbAccessor.query('tenants', tenantKey, 'inventory', productId)
    .then(doc => {
      if (!doc.exists) throw Error('This organization has stopped collecting this product.')
      let upc = doc.data().upc
      data.upc = upc
      let newTransactionRef = dbAccessor.getNewDocumentKey('transaction')
      
      /* eslint-disable promise/no-nesting */
      return dbAccessor.updateInTransaction((transaction) => {
        // step 0: read and lock all data
        let readDataPromises = [
          transaction.get(dbAccessor.buildStoreQuery(['balance', balanceKey])),
          transaction.get(dbAccessor.buildStoreQuery(['tasks', 'tasks', 'active', taskKey]))
        ]
        if (data.warehouse === 'self') {
          let inventoryKey = `${tenantKey}_${productId}`
          readDataPromises.push(transaction.get(dbAccessor.buildStoreQuery(['userLimitedInfo', userKey, 'inventory', inventoryKey])))
          readDataPromises.push(transaction.get(dbAccessor.buildStoreQuery(['tenants', tenantKey, 'inventory', productId])))
        } else if (data.warehouse === 'warehouse') {
          data.packages.forEach(pkg => {
            readDataPromises.push(transaction.get(dbAccessor.buildStoreQuery(['warehouses', pkg.warehouseKey, 'packages', pkg.packageID])))
          })
        }
        
        return Promise.all(readDataPromises)
          .then(async docs => {
            let [balanceDoc, taskDoc, ...restDocs] = docs
            let userInventoryDoc, tenantProductDoc, packageDocs
            if (data.warehouse === 'self') {
              userInventoryDoc = restDocs[0]
              tenantProductDoc = restDocs[1]
            } else if (data.warehouse === 'warehouse') {
              packageDocs = restDocs
              let {createTime} = taskDoc.data()
              if (packageDocs.some(doc => (doc.data().upc !== data.upc))) {
                throw Error('upc-unmatch')
              }
              if (packageDocs.some((doc) => ( createTime.toDate() < moment(doc.data().createTime.toDate()).subtract(45, 'days').toDate() ))) {
                throw Error('(Past Due) Cannot confirm the package(s) with this task. Please contact support.')
              }
            }

            let currentTime = new Date()
            data.createTime = currentTime
            data.lastModifiedTime = currentTime
            data.transactionType = 'inbound'
            data.minQuantity = data.minQuantity || 0
            data.bonus = data.bonus || 0
            data.isPending = true
            if (data.pendingPeriod > 0) {
              data.pendingEndDate = moment(currentTime).add(data.pendingPeriod, 'days').toDate()
            } else {
              data.isPending = false
            }
            
            if (data.warehouse === 'warehouse') {
              updatePackages(transaction, packageDocs, data, newTransactionRef)
            }

            updateTask(transaction, taskDoc, data)
            
            updateBalance(transaction, balanceDoc, data)
        
            if (data.warehouse === 'self') {
              updateTenantInventory(transaction, tenantProductDoc, data)
              updateUserInventory(transaction, userInventoryDoc, data)
            }

            addToTransaction(transaction, newTransactionRef, data)
            return 'success'
          })
        })
        .then(() => {
          return 'success'
        })
        .catch(error =>{
          if (error.message === 'already-confirmed') {
            logger.log('already confirmed, skip')
            return Promise.resolve('success')
          } else if (error.message === 'quantity-zero-skip') {
            logger.log('total quantity is zero, skip the whole transaction')
            return Promise.resolve('success')
          }
          error.info = error.message
          throw error
        })
    })
}

function updatePackages (transaction, packageDocs, data, newTransactionRef) {
  let updateField = {
    isConfirmed: true,
    transactionKey: newTransactionRef.id,
    confirmedTime: data.createTime,
    lastModifiedTime: data.createTime
  }
  let packages = []
  let transTrackingConfirmed = []
  data.quantity = 0
  packageDocs.forEach((packageDoc, index) => {
    let thePackage = packageDoc.data()
    if (!packageDoc.exists || thePackage.organizationKey !== data.tenantKey) throw Error('package-missing')
    let {upc, trackings, quantity} = thePackage
    if (thePackage.isConfirmed !== true) {
      data.quantity += thePackage.quantity
      transTrackingConfirmed = [...transTrackingConfirmed, ...data.packages[index].trackingConfirmed]
      packages.push({upc, trackings, quantity, packageID: packageDoc.id, trackingConfirmed: data.packages[index].trackingConfirmed})
      transaction.update(packageDoc.ref, updateField)
    }
  })
  if (typeof data.quantity !== 'number') throw Error('Package quantity type error, please contact technical support.')
  data.trackingConfirmed = transTrackingConfirmed
  data.packages = packages
}

function updateTask (transaction, taskDoc, data) {
  if (!taskDoc.exists) throw Error('task is missing')
  let {quantity, comfirmedTotal, confirmedPackages = []} = taskDoc.data()
  if (data.quantity === 0) throw Error('quantity-zero-skip')
  let taskQuantity = quantity - data.quantity
  let taskConfirmTotal = comfirmedTotal + data.quantity
  if (taskQuantity < 0) throw Error('quantity-error')
  if (taskQuantity === 0) {
    logger.log('task finished. Remove now')
    transaction.delete(taskDoc.ref)
  } else {
    let confirmTime = new Date()
    if (!data.packages) {
      transaction.update(taskDoc.ref, {quantity: taskQuantity, comfirmedTotal: taskConfirmTotal})
      return
    }
    let packages = data.packages.map(pkg => {
      const {packageID, trackingConfirmed, upc, quantity} = pkg
      return {packageKey: packageID, trackingConfirmed, upc, quantity, confirmTime}
    }) 
    transaction.update(taskDoc.ref, {quantity: taskQuantity, comfirmedTotal: taskConfirmTotal, confirmedPackages: [...packages, ...confirmedPackages]})
  }
}

function updateBalance (transaction, balanceDoc, data) {
  if (!balanceDoc.exists) {
    logger.error ('balance document does not exisit for this user and tenant: ', data.userKey, tenantKey)
    throw Error('balance-doc-missing')
  }

  let userBalance = balanceDoc.data()
  let cost = (data.warehouse === 'self') ? data.quantity*addNumbers(data.price, data.bonus) : data.price*data.quantity
  data.newTotalBalance = addNumbers((userBalance.total || 0), cost)
  let total = data.newTotalBalance
  if (data.pendingPeriod === 0) {
    let released = addNumbers((userBalance.released || 0), cost)
    transaction.update(balanceDoc.ref, {total, released})
  } else {
    let pending = addNumbers((userBalance.pending || 0), cost)
    transaction.update(balanceDoc.ref, {total, pending})
  }
}

function updateTenantInventory (transaction, tenantProductDoc, data) {
  if (!tenantProductDoc.exists) {
    logger.error('Document does not exist, create one please')
    throw Error('tenant-product-missing')
  } else {
    let {productId, userKey} = data
    let productRef = tenantProductDoc.ref
    let tenantProductData = tenantProductDoc.data()
    let distribution = tenantProductData['distribution'] ? tenantProductData['distribution'] : {}
    let addressEncode =  Buffer.from(productId + userKey + data.warehouseSite).toString('base64')
    let oldValue = (distribution[addressEncode] && distribution[addressEncode].quantity) || 0
    distribution[addressEncode] = {
      uid: userKey,
      userName: (data.userName || userKey),
      warehouseSite: data.warehouseSite,
      siteName: data.siteName || data.warehouseSite,
      quantity: addNumbers(oldValue, data.quantity)
    }

    let quantity = tenantProductData['quantity'] ? addNumbers(tenantProductData['quantity'], data.quantity) : data.quantity
    let inbound = tenantProductData['inbound'] ? addNumbers(tenantProductData['inbound'], data.quantity) : data.quantity
    transaction.update(productRef, {distribution, quantity, inbound})
  }
}

function updateUserInventory (transaction, userInventoryDoc, data) {
  let {tenantKey, upc, userKey, quantity, warehouseSite, productId='', productName='', productCondition=''} = data
  let newDoc = {}
  if (userInventoryDoc.exists) {
    newDoc = {
      productName, // just update in case changed
      upc, // just update in case changed
      quantity: userInventoryDoc.data().quantity, 
      distribution: userInventoryDoc.data().distribution
    }
  } else {
    newDoc = {
      tenantKey: tenantKey,
      productId,
      productCondition,
      productName,
      upc,
      quantity: 0,
      distribution: {}
    }
  }

  // update data
  newDoc.quantity += quantity
  newDoc.price = addNumbers(data.price, data.bonus)
  let addressEncode =  Buffer.from(warehouseSite).toString('base64')
  let detail = newDoc.distribution[addressEncode]
  if (detail) {
    detail.quantity += quantity
  } else {
    newDoc.distribution[addressEncode] = {
      warehouseSite,
      quantity
    }
  }

  // update or create data
  if (userInventoryDoc.exists) {
    transaction.update(userInventoryDoc.ref, newDoc)
  } else {
    transaction.set(userInventoryDoc.ref, newDoc)
  }
}

function addToTransaction (transaction, newTransactionRef, data) {
  let {trackingNums, ...payload} = data
  let trackingConfirmed = payload.trackingConfirmed ? payload.trackingConfirmed.map(tracking => tracking.toLowerCase()) : []
  payload.searchKeywords = [payload.offerKey, ...(payload.searchKeywords || splitProductName(payload.productName)), ...trackingConfirmed]
  delete payload.pendingPeriod
  transaction.set(newTransactionRef, payload)  
}

