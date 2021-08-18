export default function synchroWarehouseAddress(data, context) {
  let {warehouseKey} = data
  let {db, dbAccessor} = context.appContext

  let updateSites = dbAccessor.query('warehouses', warehouseKey, 'sites')
      .then((docs) => {
        let sites = []
        docs.forEach(doc => {
          sites.push({...doc.data(), key: doc.id})
        })
        return sites
      })
      .then((sites) => {
        return dbAccessor.query('warehouses', warehouseKey, 'organizations')
          .then(docs => {
            let tenantKeys = []
            let writeSites = []
            docs.forEach(doc => {
              tenantKeys.push(doc.id)
            })
            tenantKeys.forEach((tenantKey) => {
              writeSites.push(db.runTransaction(t => {
                return t.get(db.collection('tenantLimitedInfo').doc(tenantKey))
                  .then(doc => {
                    if (doc && doc.data() && doc.data().warehouses) {
                      let warehouses = doc.data().warehouses
                      let index = warehouses.findIndex(warehouse => {
                        return warehouse.warehouseKey === warehouseKey
                      })
                      if (index !== -1) {
                        warehouses[index].sites = sites
                      }
                      return t.update(db.collection('tenantLimitedInfo').doc(tenantKey), {warehouses: warehouses})
                    }
                  })
              }))
            })
            return Promise.all(writeSites)
          })
      })

  return updateSites
    .then(() => {
      logger.log('Success!')
    })
}