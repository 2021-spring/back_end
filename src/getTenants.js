export default function getTenants(data, context) {
    let dbAccessor = context.appContext.dbAccessor
    const {uid, token = {}} = context.auth
    let tenants = []
    return dbAccessor.query('tenants')
            .then(docs => {
              docs.forEach(doc => {
                tenants.push(doc.data())
              })
            return tenants
          })
}
