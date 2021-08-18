
function removeFromTenantGroup(dbAccessor, tenantKey, uid) {
  return dbAccessor.query('tenants', tenantKey, 'groups')
    .then(docs => {
      // got all groups
      let promises = docs.docs.filter(doc => {
        return doc.data().uid === true
      })
      .map(groupDoc =>{
        return dbAccessor.remove('tenants', tenantKey, 'groups', groupDoc.id)
      })

      return Promise.all(promises)
    })
}

function updateGroupOnUserDelete(dbAccessor, uid, user) {
      const oldWorkfor = user.workfor || {}
      let deleteFromTenantPromises = Object.keys(oldWorkfor).map(tenantKey => {
        return removeFromTenantGroup(dbAccessor, tenantKey, uid)
      })
      return Promise.all(deleteFromTenantPromises)
        .catch(error => {
          logger.error('--- Error update groups on user changes: ', error)
          throw new Error('update groups failed')
        })
}

function updateGroupOnUserUpdate(dbAccessor, uid, oldData, newData) {
  const oldWorkfor = oldData.workfor
  const newWorkfor = newData.workfor

  //only check for remove
  let removedTenants = oldWorkfor ?
    Object.keys(oldWorkfor).filter(item => {
      return oldWorkfor[item] === 3 && !(newWorkfor[item] && newWorkfor[item] === 3)
    })
    :
    []

  let deleteFromTenantPromises = removedTenants.map(tenantKey => {
    return removeFromTenantGroup(dbAccessor, tenantKey, uid)
  })
  return Promise.all(deleteFromTenantPromises)
    .then((jobs) => {
      logger.log(`Updated ${jobs.length} docs`)
      return 'done'
    })
    .catch(error => {
      logger.error('--- Error update groups on user changes: ', error)
      throw new Error('update groups failed')
    })
}

export {updateGroupOnUserDelete, updateGroupOnUserUpdate}