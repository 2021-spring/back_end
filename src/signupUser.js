import * as functions from "firebase-functions"
import grantUserRole from './grantUserRole'

function provisionTenantUser(db, uid, data) {
  let batch = db.batch()
  let tenantKey = db.collection('tenants').doc()
  let {overrideKey, name, email, password, ...userExtra } = data
  userExtra.email = email
  userExtra.organizations = [tenantKey.id]
  let warehouses=[{warehouseKey: tenantKey.id, warehouseName: 'self', sites: []}]
  batch.set(tenantKey, {
    name, 
    email, 
    paymentMethods: [],
    users: [{
      key: tenantKey.id,
      name,
      email,
      roles: ['orgOwner']
    }]
  })
  batch.set(db.collection('users').doc(uid), {name, ...userExtra})
  batch.set(db.collection('tenantLimitedInfo').doc(tenantKey.id), {pendingPeriod: 7, name, warehouses, email})
  batch.set(db.collection('warehouses').doc(tenantKey.id), {name})
  batch.set(db.collection('userLimitedInfo').doc(uid), {name})
  return batch.commit()
}

function provisionWarehouseUser(db, uid, data) {
  let batch = db.batch()
  let warehouseKey = db.collection('warehouses').doc()
  let {overrideKey, name, email, password, ...userExtra } = data
  userExtra.email = email
  userExtra.warehouses = [warehouseKey.id]
  batch.set(warehouseKey, {
    name, 
    users: [{
      key: uid,
      name,
      email,
      roles: ['warehouseOwner']
    }], 
    limitOrgNum: 1
  })
  batch.set(db.collection('warehouseLimitedInfo').doc(warehouseKey.id), {
    warehouseName: name,
    orgSettings: {isAcceptNewOrg: true},
    isListed: false,
    email
  })
  batch.set(db.collection('users').doc(uid), {
    name, 
    ...userExtra,
    users: [{
      key: uid,
      name,
      email,
      roles: ['warehouseOwner']
    }]
  })
  batch.set(db.collection('userLimitedInfo').doc(uid), {name, email})
  return batch.commit()
}

function provisionRegularUser(db, uid, data) {
  let batch = db.batch()
  let {overrideKey, password, ...userExtra } = data
  batch.set(db.collection('users').doc(uid), {
    ...userExtra, 
    paymentMethods: [], 
    blockPaymentRequest: []
  })
  batch.set(db.collection('userLimitedInfo').doc(uid), {name: data.name, address: []})
  return batch.commit()
}

export default function signupUserFunc(appContext) {
  return functions.https.onCall(async (data, context) => {
    let {admin, db, dbAccessor, auth} = appContext
    let {email, password, phoneNumber, referral = '', name, role} = data
    let codeDocs
    logger.log('Start signing up user with data: ', {data})

    if (!email || !password) {
      throw new functions.https.HttpsError('invalid-argument', 'email and password are required to register a new user')
    }
    let userData = {
      email,
      emailVerified: false,
      password,
      disabled: false
    }

    phoneNumber && (userData.phoneNumber = phoneNumber)
    name && (userData.displayName = name)
    let uid = null
    return auth.createUser(userData)
            .then(async userRecord => {
              uid = userRecord.uid
              let provision = null
              switch(role) {
                case 0:
                  await grantUserRole({email: data.email, roles: ['orgOwner']}, {appContext})
                  provision = provisionTenantUser(db, uid, data)
                  break
                case 2:
                  await grantUserRole({email: data.email, roles: ['warehouseOwner']}, {appContext})
                  provision = provisionWarehouseUser(db, uid, data)
                  break
                case 1:
                default:
                  await grantUserRole({email: data.email, roles: ['user']}, {appContext})
                  provision = provisionRegularUser(db, uid, data)
                  break
              }
              return provision
            })
            .then(() => {
              return codeDocs ? dbAccessor.remove('sysAdmin', 'general', 'codes', codeDocs.docs[0].id) : Promise.resolve('success')
            })
            .then(() => {
              return uid
            })
            .catch((error) => {
              logger.log("---------Error creating new user:", error);
              if (uid) {
                return auth.deleteUser(uid)
                        .catch(errorRollback => {
                          logger.log("---------fail to roll back new user:", errorRollback);
                          throw new functions.https.HttpsError('internal', 'failed to create new user, and cannot roll back new firebase user. ' + error ? error.message : '')
                        })
                        .then(() => {
                          logger.log("---------successfully roll back new user:", email, uid);
                          throw new functions.https.HttpsError('internal', 'failed to create new user, changes have been roll back. ' + error ? error.message : '')
                        })
              } else {
                throw new functions.https.HttpsError('internal', 'failed to create new user. ' + error ? error.message : '')
              }
            });
  })
}
