import moment from 'moment'
import {addNumbers} from '../utils/tools'

/* 
***************************
request body:

{
	"data": {
	"overrideKey": "20180601",
  "tenantKey": "0zqW0cWLTWRSTOVGdM7k",
  "skipMonth": 0
	"timeRange": 4
	}
}

***************************
*/
function checkDuplicateArray (array) {
  let set = new Set(array)
  newArray = [...set]
  if (array.length === newArray.length) {
    return false
  } else {
    return true
  }
}

export default async function auditClientBalance(data, context) {
  let dbAccessor = context.appContext.dbAccessor
  let {tenantKey, skipMonth, timeRange} = data
  if (!timeRange) timeRange = 3
  logger.log(`start audit ${tenantKey}, time range: ${timeRange} month(s)`)
  let auditStartDate = moment(new Date()).subtract(skipMonth, 'months').toDate()
  let auditEndDate = moment(new Date()).subtract((skipMonth + timeRange), 'months').toDate()
  
  let predicates = [{
    field: 'tenantKey',
    compare: '==',
    value: tenantKey
  },
  {
    field: 'createTime',
    compare: '>=',
    value: auditStartDate
  },
  {
    field: 'createTime',
    compare: '<=',
    value: auditEndDate
  }]
  let docs = await dbAccessor.queryWithPredicatesAndOrder(predicates, ['transaction'], 'createTime', true) // desc just to save an index

  if (docs.docs.length !== 0) {
    let userMap = {}
    docs.forEach(doc => {
      let aTransaction = doc.data()
      let packageIDs = aTransaction.packages.map(pkg => pkg.packageID)
      if (checkDuplicateArray(packageIDs)) throw Error(`Duplicate package detected in transaction: ${doc.id}`)
      if (userMap[aTransaction.userKey]) {
        userMap[aTransaction.userKey].push(doc)
      } else {
        userMap[aTransaction.userKey] = [doc]
      }
    })
    let promises = Object.keys(userMap).map(userKey => {
      return computeBalance(userMap[userKey])
    })
    return Promise.all(promises)
  } else {
    return 'Wrong tenant key, no user matched'
  }
}

async function computeBalance (docArray) {
  if (docArray.length === 0) return `0 transaction between tenant: ${tenantKey} & user: ${userKey}.`
  let lastIndex = docArray.length - 1
  let {newTotalBalance, userKey, tenantKey} = docArray[lastIndex].data()
  let currentBalance = newTotalBalance
  let errorTransaction = null
  for (let i = lastIndex - 1; i >= 0; i--) {
    let doc = docArray[i]
    let aTransaction = doc.data()
    aTransaction.transactionKey = doc.id
    let {transactionType, newTotalBalance, isPayment} = aTransaction
    let amount = 0
    if (transactionType === 'inbound') {
      let {quantity, price, bonus, warehouse} = aTransaction
      amount = addNumbers(price, (warehouse === 'self' ? bonus : 0)) * quantity
    }
    if (transactionType === 'payment') {
      amount = isPayment ? -aTransaction.amount : aTransaction.amount
    }
    if (transactionType === 'reportLost') {
      amount = -aTransaction.amount
    }
    if (newTotalBalance !== addNumbers(amount, currentBalance)) {
      errorTransaction = aTransaction
      errorTransaction.expectedNewTotalBalance = addNumbers(amount, currentBalance)
      break
    }
    currentBalance = newTotalBalance
  }
  
  if (!errorTransaction) {
    let rtn = `Finished. ${docArray.length - 1} transactions between tenant: ${tenantKey} & user: ${userKey} have been audited.`
    logger.log(rtn)
    return rtn
  } else {
    logger.error('Balance error, check expectedNewTotalBalance field', errorTransaction)
    return `Balance error, ${errorTransaction.transactionKey}`
  }
}