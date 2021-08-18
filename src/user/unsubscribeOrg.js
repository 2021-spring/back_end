export default async function unsubscribeOrg (data, context) {
  const { db, dbAccessor } = context.appContext
  const { tenantKey, userKey } = data

  await deleteActiveTasks(dbAccessor, db, {userKey, tenantKey})
  await deleteUserFromTenantGeneralSetting(dbAccessor, {userKey, tenantKey})
  await deleteUserFromTenantGroup(dbAccessor, {userKey, tenantKey})
  await deleteUserFromUserInfo(dbAccessor, {userKey, tenantKey})
}

async function deleteUserFromTenantGroup (dbAccessor, {userKey, tenantKey}) {
  const groupDocs = await dbAccessor.query('tenants', tenantKey, 'groups')
  const docsToUpdate = groupDocs.docs.filter(doc => {
    const {members} = doc.data()
    return members.some(item => item.uid === userKey)
  })
  const batchSize = 200
  const batchQty = Math.ceil(docsToUpdate.size / 200)
  for (let i = 0; i < batchQty; i++) {
    const batch = dbAccessor.batch()
    
    docsToUpdate.forEach((doc, index) => {
      if (index >= i * batchSize && index <= (i - 1) * batchSize) {
        const {members} = doc.data()
        batch.update(doc.ref, {
          members: members.filter(item => item.uid !== userKey)
        })
      }
    })
    await batch.commit()
  }
}

async function deleteUserFromUserInfo (dbAccessor, {userKey, tenantKey}) {
  await dbAccessor.updateInTransaction(async transaction => {
    const doc = await transaction.get(dbAccessor.buildStoreQuery(['users', userKey]))
    const {workfor = {}} = doc.data()
    delete workfor[tenantKey]
    transaction.update(doc.ref, dbAccessor.addUpdateDocTimestamp({
      workfor
    }))
  })
}

async function deleteUserFromTenantGeneralSetting (dbAccessor, {userKey, tenantKey}) {
  await dbAccessor.updateInTransaction(async transaction => {
    const doc = await transaction.get(dbAccessor.buildStoreQuery(['tenants', tenantKey, 'general', 'users']))
    const {users} = doc.data()
    transaction.update(doc.ref, dbAccessor.addUpdateDocTimestamp({
      users: users.filter(user => user.uid !== userKey) 
    }))
  })
}

async function deleteActiveTasks (dbAccessor, db, {userKey, tenantKey}) {
  const predicates = [
    {
      field: 'uid',
      compare: '==',
      value: userKey
    },
    {
      field: 'tenantKey',
      compare: '==',
      value: tenantKey
    }
  ]
  const activeTaskDocs = await dbAccessor.queryWithPredicates(predicates, 'tasks', 'tasks', 'active')
  const batchSize = 200
  const batchQty = Math.ceil(activeTaskDocs.size / 200)
  for (let i = 0; i < batchQty; i++) {
    const batch = dbAccessor.batch()
    
    activeTaskDocs.forEach((doc, index) => {
      if (index >= i * batchSize && index <= (i - 1) * batchSize) {
        batch.delete(doc.ref)
        batch.set(db.collection('canceledTasks').doc(), {
          ...doc.data(),
          taskKey: doc.id,
          isPurgeBySys: true
        })
      }
    })
    await batch.commit()
  }
}