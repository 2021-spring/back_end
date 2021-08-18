const PRODUCT_HISTORY_LIMIT = 200
const QUERY_LIMIT = 5000

export default async function collectProductPriceData (data, context) {
  let productPricesMap = {} // tenantKey => productId => offerId+price / productTransfer
  const {db, dbAccessor} = context.appContext
  const now = new Date()
  let lastTime = new Date(0)
  let sysAdmin = await dbAccessor.query('sysAdmin', 'general')

  let cronjob = sysAdmin.get('cronjobTimes') || {}
  

  let { productPriceLastScanDate } = cronjob
  if (productPriceLastScanDate && productPriceLastScanDate.seconds) {
    lastTime = productPriceLastScanDate.toDate()
  } 
  if (lastTime === now) {
    return Promise.resolve(`${now.toLocaleDateString()} has been scanned`)
  }
  let isTransactionDocsEnd = false
  let startAfter = null
  let transactionRefs = db.collection('transaction')
                          .where('transactionType', '==', 'inbound')
                          .where('createTime', '>=', lastTime)
                          .where('createTime', '<', now)
                          .orderBy('createTime')

  while (!isTransactionDocsEnd) {
    let snapshots 
    if (!startAfter) {
      snapshots = await transactionRefs.limit(QUERY_LIMIT).get()
    } else {
      snapshots = await transactionRefs.startAfter(startAfter).get()
    }
    snapshots.docs.forEach(doc => {
      collectOfferPrices(doc.data(), productPricesMap)
    })
    if (snapshots.docs.length === QUERY_LIMIT) startAfter = snapshots.docs[QUERY_LIMIT - 1]
    else {
      isTransactionDocsEnd = true
      startAfter = snapshots.docs[snapshots.docs.length - 1] || {}
    }
    logger.log(`Return ${snapshots.docs.length} inbound transaction, current last one is ${startAfter.id}`)
  }

  const results = await Promise.all(
    Object.keys(productPricesMap).reduce((preArray, tenantKey) => {
      let curPromises = Object.keys(productPricesMap[tenantKey]).map(async productId => {
        const priceItems = productPricesMap[tenantKey][productId]
        const ref = dbAccessor.buildStoreQuery(['tenants', tenantKey, 'priceHistory', productId])
        return dbAccessor.updateInTransaction(async transaction => {
          const doc = await transaction.get(ref)
          if (doc.exists) {
            let {inbound = []} = doc.data()
            priceItems.forEach(item => {
              const index = inbound.findIndex(priceHistoryItem => 
                priceHistoryItem.type === item.type &&
                priceHistoryItem.offerId === item.offerId &&
                priceHistoryItem.price === item.price &&
                (item.type === 'offerSelf' ? item.bonus === priceHistoryItem.bonus : true)
              )
              if (index >= 0) inbound[index].quantity += item.quantity
              else inbound.push(item) 
            })
            return transaction.update(ref, dbAccessor.addUpdateDocTimestamp({inbound}))
          } 
          return transaction.set(ref, dbAccessor.addNewDocTimestamp({
            inbound: priceItems
          }))     
        })  
      })
      return [...preArray, ...curPromises]
    }, [])
  )

  // todo: make a file log and store in storage
  await dbAccessor.updateFields({
    'cronjobTimes.productPriceLastScanDate': dbAccessor.getServerTimestamp()
  }, 'sysAdmin', 'general')

  return 'success'
}

/*
 * 
 * @param {object[]} productPrices 
 * @param {object} priceItem 
 */
function setProductPrice (productPricesMap, priceItem, tenantKey = '', productId = '') {
  let index = -1
  if (!(tenantKey in productPricesMap)) {
    productPricesMap[tenantKey] = {}
  }
  if (!(productId in productPricesMap[tenantKey])) {
    productPricesMap[tenantKey][productId] = []
  }
  index = productPricesMap[tenantKey][productId].findIndex(item => 
    item.type === priceItem.type &&
    item.price === priceItem.price && (
      item.type === 'offerSelf' ? item.bonus === priceItem.bonus : true
    )  
  )
  if (index >= 0) {
    productPricesMap[tenantKey][productId][index].quantity += priceItem.quantity
  } else {
    productPricesMap[tenantKey][productId].push(priceItem)
    if (productPricesMap[tenantKey][productId].length > PRODUCT_HISTORY_LIMIT) {
      productPricesMap[tenantKey][productId] = productPricesMap[tenantKey][productId].slice(-PRODUCT_HISTORY_LIMIT)
    }
  }
}


function collectOfferPrices (transaction, productPricesMap) {
  let priceItem
  if (transaction.warehouse === 'self') {
    priceItem = {
      type: 'offerSelf',
      offerId: transaction.offerKey,
      price: transaction.price,
      bonus: transaction.bonus,
      dateTime: transaction.createTime.toDate(),
      quantity: transaction.quantity
    }
  } else {
    priceItem = {
      type: 'offerWarehouse',
      offerId: transaction.offerKey,
      price: transaction.price,
      dateTime: transaction.createTime.toDate(),
      quantity: transaction.quantity
    }
  }
  priceItem && setProductPrice(productPricesMap, priceItem, transaction.tenantKey, transaction.productId)
}
