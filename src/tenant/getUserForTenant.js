import getUserForTenantHelper from './getUserForTenantHelper'

export default function getUserForTenant(data, context) {
    let dbAccessor = context.appContext.dbAccessor
    const {uid, token = {}} = context.auth
    let tenantKey = data.tenantKey

    // todo: should we query users or tenants for relation
    return getUserForTenantHelper(tenantKey, dbAccessor, data.approvalType)
}
