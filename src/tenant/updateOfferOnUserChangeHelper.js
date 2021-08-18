function updateOfferOnUserDelete(dbAccessor, uid) {
      const predicates = [{
        field: `userVisible`,
        compare: 'array-contains',
        value: uid
      }]

      // remove from userVisible and (selected.users or groups)
      return dbAccessor.queryWithPredicates(predicates, 'offers', 'offers', 'active')
        .then(docs => {
          let promises = docs.docs.map(doc => {
            const key = doc.id
            const data = doc.data()
            let changedField = {}
            let userVisibleSet = new Set(data.userVisible)
            userVisibleSet.delete(uid)
            changedField.userVisible = Array.from(userVisibleSet)

            if (data.selected && data.selected.users && data.selected.users.length > 0) {
              changedField.selected = data.selected
              let selectedUsersSet = new Set(data.selected.users)
              selectedUsersSet.delete(uid)
              changedField.selected.users = Array.from(selectedUsersSet)
            }
            
            return dbAccessor.updateFields(changedField, 'offers', 'offers', 'active', key)
          })
          return Promise.all(promises)
        })
        .then(jobs => {
          logger.log(`Updated ${jobs.length} docs`)
          return 'done'
        })
        .catch(error => {
          logger.error('--- Error update offers on user delete: ', error)
          throw new Error('update offer failed')
        })
}

function updateOfferOnUserUpdate(dbAccessor, uid, oldData, newData) {
  const oldWorkfor = oldData.workfor || {}
  const newWorkfor = newData.workfor || {}
  let updatePromise = []
  //get the added tenants
  let addedTenants = Object.keys(newWorkfor).filter(item => {
    return newWorkfor[item] === 3 && !(oldWorkfor[item] && oldWorkfor[item] === 3)
  })

  let updateforNewTenantsPromises = addedTenants.map(tenantKey => {
    const predicates = [{
      field: `tenantKey`,
      compare: '==',
      value: tenantKey
    }, {
      field: `isPublic`,
      compare: '==',
      value: true
    }]
    return dbAccessor.queryWithPredicates(predicates, 'offers', 'offers', 'active')
      .then(docs => {
        logger.log('Update user trigger, total docs to be updated:  ', docs.size)
        let updateOfferPromises = docs.docs.map(doc => {
          return dbAccessor.updateInTransaction(transaction => {
            let offerRef = dbAccessor.buildStoreQuery(['offers', 'offers', 'active', doc.id])
            return transaction.get(offerRef)
              .then(tdoc => {
                let userVisibleSet = new Set(tdoc.data().userVisible)
                userVisibleSet.add(uid)
                let userVisible = Array.from(userVisibleSet)
                return transaction.update(offerRef, {userVisible})
              })
          })
        })
        return Promise.all(updateOfferPromises)
      })
  })

  //get the removed tenants
  let removedTenants = Object.keys(oldWorkfor).filter(item => {
    return oldWorkfor[item] === 3 && !(newWorkfor[item] && newWorkfor[item] === 3)
  })

  let updateforRemovedTenantsPromises = removedTenants.map(tenantKey => {
    const predicates = [{
      field: `tenantKey`,
      compare: '==',
      value: tenantKey
    },
    {
      field: `userVisible`,
      compare: 'array-contains',
      value: uid
    }]
    return dbAccessor.queryWithPredicates(predicates, 'offers', 'offers', 'active')
      .then(docs => {
        logger.log('Update user trigger, total docs to be removed:  ', docs.size)
        let updateOfferPromises = docs.docs.map(doc => {
          return dbAccessor.updateInTransaction(transaction => {
            let offerRef = dbAccessor.buildStoreQuery(['offers', 'offers', 'active', doc.id])
            return transaction.get(offerRef)
              .then(tdoc => {
                let aOffer = tdoc.data()
                // let {[uid]: val, ...userVisible} = aOffer.userVisible
                let userVisibleSet = new Set(aOffer.userVisible)
                userVisibleSet.delete(uid)
                let userVisible = Array.from(userVisibleSet)
                let newValue = { userVisible, selected: aOffer.selected }
                let users = aOffer.selected && aOffer.selected.users
                users = users && users.filter(user => user !== uid)
                users && (newValue.selected = {}) && (newValue.selected.users = users)
                return transaction.update(offerRef, newValue)
              })
          })
          
        })
        return Promise.all(updateOfferPromises)
      })
  })

  return Promise.all([...updateforNewTenantsPromises, ...updateforRemovedTenantsPromises])
    .then((arr) => {
      logger.log(`Updated ${arr.length} documents`)
      return 'done'
    })
    .catch(error => {
      logger.error('--- Error update offers on user changes: ', error)
      throw new Error('update offer failed')
    })
}

export {updateOfferOnUserDelete, updateOfferOnUserUpdate}

