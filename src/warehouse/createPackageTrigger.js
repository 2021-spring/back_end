import * as functions from "firebase-functions"

export default function createPackageTriggerFunc(appContext) {
  return functions.firestore.document('warehouses/{warehouseKey}/packages/{packageId}').onCreate((snap, context) => {
    context.appContext = appContext
    let {warehouseKey, packageId} = context.params
    let firebase = appContext.firebase
    let pkg = snap.data()
    pkg.addedToInventoryTime && (pkg.addedToInventoryTime = pkg.addedToInventoryTime.toDate())
    pkg.createTime && (pkg.createTime = pkg.createTime.toDate())
    return firebase.ref(`packages/${warehouseKey}`).child(packageId).set(pkg)
  });
}
