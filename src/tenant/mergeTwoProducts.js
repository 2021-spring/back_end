/**
 * 
 * @param {String} distributionMapKey from product doc 
 * 
 * @return 
 *   0 -> self type,
 *   1 -> warehouse type
 */
function checkDistributionType (distributionMapKey) {
  return distributionMapKey.slice(0, 9) === 'warehouse' ?  1 : 0
}

/**
 * 
 * @param {String} distributionMapKey(base64) 
 * 
 * @return {String} productId(8digits) + userId + site
 */
function tenantSelfDistributionKeyToString (distributionMapKey) {
  return Buffer(distributionMapKey, 'base64').toString()
}

/**
 * 
 * @param {String} distributionString
 * 
 * @return {String} key (base64)
 */
function tenantSelfDistributionStringToKey (distributionString) {
  return Buffer(distributionString).toString('base64')
}

/**
 * get the new tenant's self distribution key
 * @param {String} distributionKey base64
 * @param {String} newProductId 8digits Number String
 */
function getNewTenantSelfDistributionKey (distributionKey, newProductId) {
  return tenantSelfDistributionStringToKey(
    newProductId + tenantSelfDistributionKeyToString(distributionKey).slice(8)
  )
}

/**
 * 
 * @param {Object} data : {
 *   tenantKey: String,
 *   targetProductId: String,
 *   currentProductId: String
 * }
 * @param {*} context env 
 * 
 * @todo update transactions (inbound(confirmed) and outbound) when product doc merge 
 */
export default async function mergeTwoProducts (data, context) {
  const { db, dbAccessor } = context.appContext
  const {tenantKey, targetProductId, currentProductId} = data

  let tenantRef = db.collection('tenants').doc(tenantKey)
  let curProductRef = tenantRef.collection('inventory').doc(currentProductId)
  let targetProductRef = tenantRef.collection('inventory').doc(targetProductId)
  let relatedQueryPredicates = [
    {
      field: 'productId',
      compare: '==',
      value: currentProductId
    },
    {
      field: 'tenantKey',
      compare: '==',
      value: tenantKey
    }
  ]
  let relatedDocsList = await Promise.all([ 
    dbAccessor.queryWithPredicates(relatedQueryPredicates, 'offers', 'offers', 'active'), // Active Offers
    dbAccessor.queryWithPredicates(relatedQueryPredicates, 'offers', 'offers', 'archives'), // Archive Offers
    dbAccessor.queryWithPredicates(relatedQueryPredicates, 'offers', 'offers', 'proposes'), // Propose Offers
    dbAccessor.queryWithPredicates(relatedQueryPredicates, 'tasks', 'tasks', 'active') // Active Tasks
  ])

  return db.runTransaction(async transaction => {
    let tenantDoc = await transaction.get(tenantRef)
    if (!tenantDoc.exists) throw Error('tenant-not-exists')

    let tenant = tenantDoc.data()
    if (!(tenant.memberType === 1)) throw Error('invalid-memberType')
    
    let curProductDoc = await transaction.get(curProductRef)
    if (!curProductDoc.exists) throw Error('current-product-not-found')

    let curProduct = curProductDoc.data()
    // validate curProduct
    if (curProduct.upc && curProduct.upc !== '') throw Error('upc-not-empty')
    if (curProduct.distribution) {
      let distributionCount = 0
      Object.keys(curProduct.distribution).forEach(key => {distributionCount += checkDistributionType(key)})
      if (distributionCount > 0) throw Error('warehouse-distribution-exists')
    } 

    let targetProductDoc = await transaction.get(targetProductRef)
    if (!targetProductDoc.exists) throw Error('target-product-not-found')
      
    let targetProduct = targetProductDoc.data()
    let relatedUids = []

    // Start Merge
    if (targetProduct.asin && curProduct.asin) {
      targetProduct.asin = [...targetProduct.asin, ...curProduct.asin]
      targetProduct.asin = targetProduct.asin.filter((asinText, index) => targetProduct.asin.indexOf(asinText) === index)
    } else if (curProduct.asin) {
      targetProduct.asin = curProduct.asin
    } 
    if (targetProduct.distribution && curProduct.distribution) {
      Object.keys(curProduct.distribution).forEach(distributionKey => {
        let newDistributionKey = getNewTenantSelfDistributionKey(distributionKey, targetProductId)  
        if (newDistributionKey in targetProduct.distribution) {
          targetProduct.distribution[newDistributionKey].quantity += curProduct.distribution[distributionKey].quantity
          return
        }
        targetProduct.distribution[newDistributionKey] = curProduct.distribution[distributionKey]
      })
    } else if (curProduct.distribution) {
      targetProduct.distribution = {}
      for (let key in curProduct.distribution) {
        let newKey = getNewTenantSelfDistributionKey(key, targetProductId)
        targetProduct.distribution[newKey] = curProduct.distribution[key]
      }
    } 

    if (targetProduct.distribution) {
      targetProduct.quantity += curProduct.quantity
    }
    
    targetProduct.inbound += curProduct.inbound || 0
    targetProduct.note = (targetProduct.note || '') + (curProduct.note && ('\n' + curProduct.note) || '')

    if ('historyProductIds' in targetProduct) targetProduct.historyProductIds.push(currentProductId)
    else targetProduct.historyProductIds = [currentProductId]

    // merge user self Inventory
    let updateUserInventory = []
    if (curProduct.distribution) {
      relatedUids = Object.values(curProduct.distribution).map(distribution => distribution.uid)
      if (relatedUids.length) {
        for (let userUid of relatedUids) {
          let method = 'update'
          let newDocData = {}
          let curUserProductInventoryRef = db.collection('userLimitedInfo')
            .doc(userUid).collection('inventory').doc(`${tenantKey}_${currentProductId}`)
          let newDocDataRef = db.collection('userLimitedInfo')
            .doc(userUid).collection('inventory').doc(`${tenantKey}_${targetProductId}`)
          let curUserProductInventoryDoc = await transaction.get(curUserProductInventoryRef)
          if (!curUserProductInventoryDoc.exists) continue

          let targetUserProductInventoryDoc = await transaction.get(newDocDataRef)
          if (targetUserProductInventoryDoc.exists) {
            newDocData = targetUserProductInventoryDoc.data()
          } else {
            newDocData = {
              price: targetProduct.price,
              productCondition: targetProduct.condition,
              productId: targetProductId,
              productName: targetProduct.name,
              quantity: 0,
              tenantKey: tenantKey,
              upc: targetProduct.upc,
              distribution: {}
            }
            method = 'set'
          }

          let curUserProductInventory = curUserProductInventoryDoc.data()
          if (newDocData.distribution && curUserProductInventory.distribution) {
            Object.keys(curUserProductInventory.distribution).forEach(distributionKey => {
              if (distributionKey in newDocData.distribution) {
                newDocData.distribution[distributionKey].quantity += curUserProductInventory.distribution[distributionKey].quantity
              } else {
                newDocData.distribution[distributionKey] = curUserProductInventory.distribution[distributionKey]
              }
            })
          } else if (curUserProductInventory.distribution) {
            newDocData.distribution = curUserProductInventory.distribution
          }
          newDocData.quantity += curUserProductInventory.quantity

          updateUserInventory.push({
            method,
            newDocDataRef, 
            newDocData, 
            deleteRef: curUserProductInventoryDoc.ref
          })
        }
      }
    }

    let offerAndTaskUpdateObj = {
      productCondition: targetProduct.condition,
      productId: targetProductId,
      productName: targetProduct.name,
      lastModifiedTime: new Date()
    }

    // start update
    
    // if exist related user inventory
    updateUserInventory.forEach(usesTransactions => {
      if (usesTransactions.pass) return
      let {method, newDocDataRef, newDocData, deleteRef} = usesTransactions
      if (method === 'set') transaction.set(newDocDataRef, newDocData)
      if (method === 'update') transaction.update(newDocDataRef, newDocData)
      transaction.delete(deleteRef)        
    })
    
    transaction.update(targetProductRef, targetProduct)

    relatedDocsList.forEach(docs => 
      docs.forEach(doc => transaction.update(doc.ref, offerAndTaskUpdateObj))
    )

    transaction.delete(curProductRef)
    return true
  })
  .then(() => 'Merge Successfully')
}
