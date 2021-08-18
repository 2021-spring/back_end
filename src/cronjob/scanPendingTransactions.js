import moment from 'moment'
import {addNumbers} from '../utils/tools'
import env from '../config/env'

function scanTransactions (dbAccessor, overrideDate) {
  // get all pending transaction beyond pending period
  // move pending balance to released (available) balance, remove transaction pending flag
  let currentTime = overrideDate || new Date()
  let endOfToday = moment(currentTime).endOf('day').add(8, 'hours').toDate() // add 8 hours to process westen time zone
  logger.log('End of Today: ', endOfToday)
  let predicates = [
    {
      field: 'isPending',
      compare: '==',
      value: true
    },
    {
      field: `transactionType`,
      compare: '==',
      value: 'inbound'
    },
    {
      field: `pendingEndDate`,
      compare: '<=',
      value: endOfToday
    }]

    return dbAccessor.queryWithPredicatesAndOrder(predicates, ['transaction'])
      .then(docs => {
        logger.log(`found ${docs.size} matured pending transactions`)
        let changes = {}
        docs.forEach(doc => {
          let {tenantKey, userKey, quantity, price, bonus, warehouse} = doc.data()
          if (!userKey) {
            logger.error('missing userKey, ignore this transaction. docId: ', doc.id)
            return
          }
          if (!bonus) bonus = 0
          let cost = (warehouse === 'self') ? addNumbers(price, bonus) * quantity : price * quantity
          changes[tenantKey] || (changes[tenantKey] = {}) // initialize
          changes[tenantKey][userKey] || (changes[tenantKey][userKey] = {userKey: userKey, released: 0, pending: 0, transactionRefs: []}) // initialize
          let userChange = changes[tenantKey][userKey]
          userChange.released = addNumbers(userChange.released, cost)
          userChange.pending = addNumbers(userChange.pending, -cost)
          userChange.transactionRefs.push(doc.ref)
        });
        return Promise.all(Object.keys(changes).map(tenantKey => {
          return Promise.all(Object.values(changes[tenantKey]).map(change => {
            let {released, pending, userKey, transactionRefs} = change
            // eslint-disable-next-line promise/no-nesting
            return dbAccessor.updateInTransaction(transaction => {
              let promises = []
              let balanceChanges = [
                {
                  field: `released`,
                  increment: released
                },
                {
                  field: `pending`,
                  increment: pending
                },
                {
                  field: 'tenantKey',
                  equal: tenantKey
                },
                {
                  field: 'userKey',
                  equal: userKey
                }
              ]

              promises.push(dbAccessor.increaseValueInTransactionHelper(transaction, balanceChanges, ['balance', `${tenantKey}_${userKey}`]))

              transactionRefs.forEach(transactionRef => {
                promises.push(transaction.update(transactionRef, {isPending: false, lastModifiedTime: currentTime}))
              })

              return Promise.all(promises)
            })
            .catch(err => {
              logger.error(err)
              throw err
            })
          })
        )}))
      })
}

function scanTransfers (dbAccessor, overrideDate) {
  // get all pending transfers beyond pending period
  // move pending balance to released (available) balance, remove transaction pending flag
  let currentTime = overrideDate || new Date()
  let endOfToday = moment(currentTime).endOf('day').add(8, 'hours').toDate() // add 8 hours to process westen time zone
  logger.log('End of Today: ', endOfToday)
  let predicates = [
    {
      field: 'isPending',
      compare: '==',
      value: true
    },
    {
      field: `transactionType`,
      compare: '==',
      value: 'productTransfer'
    },
    {
      field: `pendingEndDate`,
      compare: '<=',
      value: endOfToday
    }]

    return dbAccessor.queryWithPredicatesAndOrder(predicates, ['transaction'])
      .then(docs => {
        logger.log(`found ${docs.size} matured pending transfers`)
        let transferChanges = {}

        docs.forEach(doc => {
          let {amount, to, userKey} = doc.data()
          transferChanges[`${to}_${userKey}`] = transferChanges[`${to}_${userKey}`] || {balanceDiff: 0, transactionRefs: []}
          transferChanges[`${to}_${userKey}`]['balanceDiff'] += amount
          transferChanges[`${to}_${userKey}`]['transactionRefs'].push(doc.ref)
        })

        return Promise.all(Object.keys(transferChanges).map(balanceKey => {
          return dbAccessor.updateInTransaction(async transaction => {
            let {balanceDiff, transactionRefs} = transferChanges[balanceKey]
            let balanceRef = dbAccessor.buildStoreQuery(['balance', balanceKey])
            let balanceDoc = await transaction.get(balanceRef)
            let {pending, released} = balanceDoc.data()
            let payload = {
              pending: addNumbers(pending, -balanceDiff), 
              released: addNumbers(released, balanceDiff)
            }

            transaction.update(balanceDoc.ref, dbAccessor.addUpdateDocTimestamp(payload))

            transactionRefs.forEach(transactionRef => {
              transaction.update(transactionRef, dbAccessor.addUpdateDocTimestamp({isPending: false}))
            })
          })
        }))
      })
}

export default function scanPendingTransactions(data, context) {
  let dbAccessor = context.appContext.dbAccessor
  const {uid, token = {}} = context.auth
  let overrideDate = env.envType !== 'production' && data.date ? new Date(data.date) : null
  logger.log('override Date: ', overrideDate)
  logger.log('start scan pending transaction')
  // get all tenants and pending period setting
  return Promise.all([scanTransactions(dbAccessor, overrideDate), scanTransfers(dbAccessor, overrideDate)])
    .then(() => { return 'success' })
}
