// data structure
//    request: { uid -> request user uid
//               requestKey -> request entity key
//               tenantKey -> tenant key
//              }
//  note: updating offers users were handled by the trigger
//
// approvalType: 
//   0 - rejected
//   1 - blocked
//   2 - limited
//   3 - accepted
//
export default function handleUserRequest(data, context) {
  /** @type {import('firebase-admin').firestore.Firestore} */
  let db = context.appContext.db
  /** @type {import('firebase-admin').firestore.FieldValue} */
  let dbFieldValue = context.appContext.dbFieldValue
  // need to verify the call user is authorized to perform this request
  const authUid= context.auth.uid

  const {request, approvalType = 3} = data
  const {requestKey, uid, tenantKey} = request
  return db.runTransaction(transaction => {
    let userDocRef = db.collection('users').doc(uid)
    let balanceDocRef = db.collection('balance').doc(`${tenantKey}_${uid}`)
    let usersDocRef = db.doc(`tenants/${tenantKey}/general/users`)
    
    return Promise.all([transaction.get(userDocRef), transaction.get(usersDocRef)])
      .then(([doc, usersDoc]) => {
        if (!doc.exists) {
          throw new Error("Document does not exist!");
        }
        const user = doc.data()
        let newWorkfor = user.workfor  || {}
        newWorkfor[tenantKey] = approvalType

        if (approvalType < 2) {
          return transaction
            .delete(db.collection('requests').doc(requestKey))
        } else {
          return (usersDoc.exists ?
            transaction.update(usersDocRef, { 
              users: dbFieldValue.arrayUnion({
                uid: doc.id,
                name: user.name,
                email: user.email,
                approvalType
              }), 
              lastModifiedTime: new Date() 
            }) :
            transaction.set(usersDocRef, { 
              users: dbFieldValue.arrayUnion({
                uid: doc.id,
                name: user.name,
                email: user.email,
                approvalType
              }),
              createTime: new Date(), 
              lastModifiedTime: new Date() 
            }) 
          )
            .update(userDocRef, {workfor: newWorkfor})
            .delete(db.collection('requests').doc(requestKey))
            .set(balanceDocRef, {tenantKey, userKey: uid, total: 0, released: 0, pending: 0, lastModifiedTime: new Date()})
            // .update(db.collection('tenants').doc(tenantKey), {userRelation: {[uid]: approvalType}})
        }
      })
      .then(() => {
        return 'handled request successfully'
      })
  })
}
