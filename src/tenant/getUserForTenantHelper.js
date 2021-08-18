// approvalType: 
//   0 - rejected
//   1 - blocked
//   2 - limited
//   3 - accepted


/**
 * 
 * @param {string} tenantKey 
 * @param {import('../utils/dbAccessor').default} dbAccessor 
 * @param {number} approvalType 
 */
export default function getUserForTenantHelper(tenantKey, dbAccessor, approvalType = 0) {
  return dbAccessor.query('tenants', tenantKey, 'general', 'users')
    .then(doc => {
      const {users = []} = doc.data() || {}

      return users.filter(user => user.approvalType >= approvalType)
    })
}
