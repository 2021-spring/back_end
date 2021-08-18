import getUserForTenantHelper from './getUserForTenantHelper'

async function resolveGroupsToUsers(dbAccessor, tenantKey, groups) {
  const userInfoDoc = await dbAccessor.query('tenants', tenantKey, 'general', 'users')
  const groupDocArray = await Promise.all(groups.map(group => dbAccessor.query('tenants', tenantKey, 'groups', group.key)))
  const {users} = userInfoDoc.data()
  let userSet = new Set()
  let userToApprovalTypeMap = {}
  
  users.forEach(user => {
    const {uid, approvalType} = user
    userToApprovalTypeMap[uid] = approvalType
  })

  groupDocArray.forEach(doc => {
    if (doc.exists) {
      const {members} = doc.data()
      members.forEach(({uid}) => {
        if (userToApprovalTypeMap[uid] === 3) {
          userSet.add(uid)
        }
      })
    }
  })
  return userSet
}

function resolveOfferUsers(dbAccessor, data) {
  let {tenantKey, isPublic = false, selected = null} = data
  let promise = Promise.resolve([])
  if (isPublic) {
    let userVisible = []
    promise = getUserForTenantHelper(tenantKey, dbAccessor, 3)
      .then(users => {
        users.forEach(user => {
          userVisible.push(user.uid)
        })

        return userVisible
      })
  } else if (selected) {
    let userVisible = {}
    selected.users && selected.users.length &&
      selected.users.forEach(user => {
        !user.key && logger.error("user.key is missing. Error format")
        userVisible[user.key] = true
      })

    if (selected.groups && selected.groups.length) {
      promise = resolveGroupsToUsers(dbAccessor, tenantKey, selected.groups)
        .then(userSet => {
          return [...Object.keys(userVisible), ...userSet]
        })
    } else {
      promise = Promise.resolve(Object.keys(userVisible))
    }
  }

  return promise
}

export {resolveOfferUsers}