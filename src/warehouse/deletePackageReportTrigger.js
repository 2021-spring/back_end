import * as functions from "firebase-functions"

function deletePackageReportWarehouseTrigger(appContext) {
  return functions.firestore.document('warehouses/{warehouseKey}/packageReports/{reportKey}').onDelete((snap, context) => {
    let {bucket} = appContext
    let {zipFile} = snap.data()
    if (zipFile) return bucket.file(zipFile).delete()
    return 'success'
  })
}

function deletePackageReportTenantTrigger(appContext) {
  return functions.firestore.document('tenants/{tenantKey}/packageReports/{reportKey}').onDelete((snap, context) => {
    let {bucket} = appContext
    let {zipFile} = snap.data()
    if (zipFile) return bucket.file(zipFile).delete()
    return 'success'
  })
}

export {deletePackageReportWarehouseTrigger, deletePackageReportTenantTrigger}
