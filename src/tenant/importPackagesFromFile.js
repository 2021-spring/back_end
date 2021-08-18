import path from 'path'
import os from 'os'
import fs from 'fs'
import xlsx from 'xlsx'

async function updateInventory (dbAccessor, rawData, organizationKey, trackingField, upcField, quantityField, siteField) {
  // **********
  // prepare to update inventory
  // **********
  let selfSites
  let productSum
  if (!organizationKey) {
    selfSites = [] 
    productSum = []
  } else {
    let tenantLimitedInfoDoc = await dbAccessor.query('tenantLimitedInfo', organizationKey)
    let {warehouses = []} = tenantLimitedInfoDoc.data()
    let selfWarehouse = warehouses.find(warehouse => warehouse.warehouseKey === organizationKey)
    let fileSitesSet = new Set()
    selfSites = (selfWarehouse && selfWarehouse.sites && selfWarehouse.sites.length > 0) ? selfWarehouse.sites : []
    productSum = rawData.reduce((sum, item) => {
      let upc = item[upcField]
      let quantity = parseInt(item[quantityField])
      if (!(item[siteField] && item[siteField].length && item[siteField].length > 0)) {
        throw Error(`Unknown site field, please check the upload file.`)
      }
      let siteName = item[siteField].trim()
      fileSitesSet.add(siteName)
      let siteMapKey = Buffer.from(siteName).toString('base64')
      item.isAddedToInventory = false
      if (!organizationKey) return sum
      if (!sum[organizationKey]) {
        sum[organizationKey] = {}
      }
      if (!sum[organizationKey][upc]) {
        sum[organizationKey][upc] = {}
      }
      if (!sum[organizationKey][upc][siteMapKey]) {
        sum[organizationKey][upc][siteMapKey] = {
          quantity: 0,
          warehouseSite: '',
          siteName: '',
          warehouseKey: '',
          items: []
        }
      }

      sum[organizationKey][upc][siteMapKey].quantity = (sum[organizationKey][upc][siteMapKey].quantity + quantity)
      sum[organizationKey][upc][siteMapKey].warehouseSite = 'self' + (siteName && '-' + siteName)
      sum[organizationKey][upc][siteMapKey].siteName = siteName
      sum[organizationKey][upc][siteMapKey].warehouseKey = organizationKey
      sum[organizationKey][upc][siteMapKey].items.push(item)
      return sum
    }, {})
    for (let siteName of fileSitesSet) {
      if (!selfSites.some(site => site.siteName === siteName)) throw Error(`Undefined site: '${siteName}', Please add site.`)
    }
  }

  let updateInventoryPromises = Object.keys(productSum).reduce((promiseArr, organizationKey) => {
    let perOrganizationArr = Object.keys(productSum[organizationKey]).map((upc) => {
      let predicates = [
        {
          field: `upc`,
          compare: '==',
          value: upc
        }
      ]

      return dbAccessor.updateInTransaction(async transaction => {
        let searchRef = dbAccessor.buildStoreQueryPredicates(dbAccessor.buildStoreQuery(['tenants', organizationKey, 'inventory']), predicates)
        let docs = await transaction.get(searchRef)

        if (docs.size === 0) {
          // todo: warehouse scan the package before tenant define product
          logger.log('product is not defined yet. contact tenant')
          return 'product missing, either not define or upc missing'
        } else {
          let productRef = dbAccessor.buildStoreQuery(['tenants', organizationKey, 'inventory', docs.docs[0].id])
          let product = docs.docs[0].data()
          let productId = docs.docs[0].id
          let distribution = product.distribution ? product.distribution : {}
          let changeQty = 0

          Object.keys(productSum[organizationKey][upc]).forEach(siteMapKey => {
            let addressEncode = Buffer.from('warehouse' + productId + siteMapKey)
            let oldValue = (distribution[addressEncode] && distribution[addressEncode].quantity) || 0
            let change = productSum[organizationKey][upc][siteMapKey]

            distribution[addressEncode] = {
              uid: organizationKey,
              userName: 'self',
              warehouseSite: change.warehouseSite,
              siteName: change.siteName || change.warehouseSite,
              quantity: oldValue + change.quantity
            }
            changeQty += change.quantity
          })
          

          let quantity = product['quantity'] ? product['quantity'] + changeQty : changeQty
          let inbound = product['inbound'] ? product['inbound'] + changeQty : changeQty
          let newValue = {
            distribution,
            quantity,
            inbound
          }
          transaction.update(productRef, newValue)
          Object.keys(productSum[organizationKey][upc])
            .forEach(site => {
              productSum[organizationKey][upc][site].items
                .forEach(item => { item.isAddedToInventory = true })
            })
          return 'success'
        }
      })
    })
    promiseArr = [...promiseArr, ...perOrganizationArr]
    return promiseArr
  }, [])

  return Promise.all(updateInventoryPromises)
}

export default function importPackagesFromFile(data, context) {
    let {db, bucket, dbAccessor} = context.appContext
    const {uid, token = {}} = context.auth
    let {tenantKey, file} = data
    let totalItems = 0
    let trackingField, upcField, quantityField, siteField
    let rawData
    // todo: validate tenant and user relationship in the future

    // retrieve file
    let localFile = path.join(os.tmpdir(), file.name)
    return bucket.file(file.fullPath).download({destination: localFile})
      .then(() => {
        const workbook = xlsx.readFile(localFile)
        const sheetNames = workbook.SheetNames
        rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetNames[0]])

        // parse and validate data
        let errorReason = null
        if (!rawData) {
          throw Error(`file can't be opened`)
        } else if (!rawData.length) {
          throw Error('file contains no data')
        } 

        trackingField = rawData[0]['tracking'] ? 'tracking' : (rawData[0]['TRACKING'] ? 'TRACKING' : (rawData[0]['Tracking'] ? 'Tracking' : ''))
        upcField = rawData[0]['upc'] ? 'upc' : (rawData[0]['UPC'] ? 'UPC' : '')
        quantityField = rawData[0]['quantity'] ? 'quantity' : (rawData[0]['QUANTITY'] ? 'QUANTITY' : (rawData[0]['Quantity'] ? 'Quantity' : ''))
        siteField = rawData[0]['site'] ? 'site' : (rawData[0]['SITE'] ? 'SITE' : (rawData[0]['Site'] ? 'Site' : 'site'))

        if (!trackingField || !upcField || !quantityField) throw Error(`Column name invalid. Don't change the first line in the template`)

        rawData.forEach(line => {
          if (!line[trackingField] || !line[upcField] || !line[quantityField]) throw Error(`Data missing. "Tracking", "UPC", "Quantity" fields are required.`)
            
          if (isNaN(parseInt(line[quantityField])) || !Number.isInteger(parseInt(line[quantityField])) || parseInt(line[quantityField]) <= 0) throw Error(`"Quantity" must be positive integer`)
        })

        // update inventory
        return updateInventory(dbAccessor, rawData, tenantKey, trackingField, upcField, quantityField, siteField)
    })
    .then(() => {
        // insert to db
      let currentTime = new Date()
      let batch = db.batch()
      rawData.forEach(item => {
        logger.log('insert one item: ', item)
        let docRef = db.collection('warehouses').doc(tenantKey).collection('packages').doc()
        let tracking = item[trackingField].toString().toUpperCase().split(' ')

        let aPackage = {
            date: currentTime,
            createTime: currentTime,
            organizationKey: tenantKey,
            quantity: parseInt(item[quantityField]),
            upc: item[upcField].toString(),
            trackings: tracking,
            isConfirmed: false,
            isAddedToInventory: item.isAddedToInventory || false
        }
        item[siteField] && (aPackage.siteName = item[siteField])
        batch.set(docRef, aPackage)
        totalItems++
      })

      return batch.commit()        
    })
    // remove temp file and the other file
    .then(() => {
      fs.unlinkSync(localFile)
      return 'ok'
    })
    .then(() => {
      return {status: 'success', totalItems: totalItems}
    })
    .catch(error => {
      fs.unlinkSync(localFile)
      throw error
    })
}
