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
    let {admin, db, dbAccessor} = appContext
    let {email, password, phoneNumber, referral = '', name, role} = data
    if (data.overrideKey !== 'lkjwnlks23432lksdf$%^$' && !context.auth) {
      // Throwing an HttpsError so that the client gets the error details.
      throw new functions.https.HttpsError('unauthenticated', 'Only signed in user can perform this operation')
    }

    let codeDocs

    if (role !== 1) {
      let roleType = ['tenant', 'user', 'warehouse'][role]
      codeDocs = await dbAccessor.queryWithPredicates([{field: 'code', compare: '==', value: referral}], 'sysAdmin', 'general', 'codes')
      let isAllowed = codeDocs.size === 1
    
      if (!isAllowed) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid referral code')
      } else { 
        let { type } = codeDocs.docs[0].data()
        if (type !== roleType) {
          let displayType = roleType === 'tenant' ? 'organization' : roleType
          throw new functions.https.HttpsError('invalid-argument', `Referral code cannot be used for ${displayType}.`)
        }
      }
    }

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
    return admin.auth().createUser(userData)
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
                return admin.auth().deleteUser(uid)
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
