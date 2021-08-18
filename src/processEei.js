import axios from 'axios'
import {axiosWrapper, MeasurementTools, ExpenseHistory, toMoney} from './utils/tools'
import env from './config/env'

export default async function processEei (data, context) {
  const { dbAccessor, bucket } = context.appContext
  const { type, requestId } = data
  
  if (type === 'create' || type === 'update') {
    return createEei(data, dbAccessor, type)
  }

  if (type === 'getStatus') {
    return getStatus(requestId, dbAccessor)
  }

  if (type === 'cancel') {
    return cancelEei(data, dbAccessor)
  }

  return 'done'
}

async function createEei(data, dbAccessor, type) {
  const {res} = await requestForEei(data, type)
  const {actionCode: ac, from, to, ...eeiEntry} = data
  const {totalAmount} = res 
  let payload = {
    ...eeiEntry,
    status: 'pending',
    keywords: [from.state, to.countryCode, eeiEntry.clientKey, eeiEntry.requestId, eeiEntry.itn]
      .map(item => item ? item.toLowerCase() : '')
      .filter(item => item),
    from,
    to
  }

  if (type === 'create') {
    const balanceRef = dbAccessor.buildStoreQuery(['systemBalance', data.clientKey])
    const transactionRef = dbAccessor.buildStoreQuery(['systemTransactions']).doc()
    await dbAccessor.updateInTransaction(async transaction => {
      const balanceDoc = await transaction.get(balanceRef)
      let {balance, expenseHistory} = balanceDoc.data()
      let newExpenseHistory = new ExpenseHistory(expenseHistory)
  
      transaction.update(balanceDoc.ref, dbAccessor.addUpdateDocTimestamp({
        balance: toMoney(balance - totalAmount),
        expenseHistory: newExpenseHistory.addExpense(totalAmount, new Date())
      }))
      transaction.set(transactionRef, dbAccessor.addNewDocTimestamp({
        totalAmount: toMoney(totalAmount),
        newBalance: toMoney(balance - totalAmount),
        clientKey: data.clientKey,
        clientName: data.clientName,
        note: `Create EEI: ${data.requestId}.`,
        type: 'label',
        subtype: 'eei',
        keywords: [...new Set([...payload.keywords, 'eei', 'AS'])].map(item => item.toLowerCase())
      }))
      transaction.set(dbAccessor.buildStoreQuery(['eeiRecords', data.requestId]), dbAccessor.addNewDocTimestamp(payload))
    })
  } else {
    await dbAccessor.updateFields(dbAccessor.addUpdateDocTimestamp(payload), 'eeiRecords', data.requestId)
  }
  
  return payload
}

function adjustCommoditiesMeasurementInPos (commodities) {
  commodities.forEach(item => {
    const {commodityWeight, isMeasurementMetric} = item
    if (isMeasurementMetric) {
      Object.assign(item, {
        weight: MeasurementTools.kg_lbs(commodityWeight),
        originWeight: commodityWeight
      })
    }
  })
}

async function requestForEei (eeiInfo, type) {
  adjustCommoditiesMeasurementInPos(eeiInfo.commodities)
  const data = {
    ...eeiInfo,
    actionCode: type === 'create' ? 'AS' : 'R',
    status: 'pending'
  }

  // console.log({data: JSON.stringify(data)})
  const res = await axiosWrapper(axios({
    method: 'post',
    url: `${env.eeveeApi.url}eei`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.eeveeApi.apiKey
    },
    data
  }))
    .then(({data}) => data)

  // console.log({res: JSON.stringify(res)})
  return {data, res}
}

async function getStatus (requestId, dbAccessor) {
  const res = await axiosWrapper(axios({
    method: 'get',
    url: `${env.eeveeApi.url}eei?requestId=${requestId}`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.eeveeApi.apiKey
    }
  })).then(({data}) => data)

  // console.log({res: JSON.stringify(res)})

  const {status, itn, message} = res
  if (status === 'rejected') {
    await dbAccessor.updateFields({
      message,
      status
    }, 'eeiRecords', requestId)    
  } else {
    await dbAccessor.updateFields({
      itn,
      status: status === 'success' ? 'ready' : status
    }, 'eeiRecords', requestId)
  }
  return res
}

async function cancelEei (data, dbAccessor) {
  // console.log(JSON.stringify(data))
  const res = await axiosWrapper(axios({
    method: 'post',
    url: `${env.eeveeApi.url}eei`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.eeveeApi.apiKey
    },
    data: {
      ...data,
      actionCode: 'D'
    }
  }))
    .then(({data}) => data)

  // console.log({res: JSON.stringify(res)})
  const {requestId, clientKey, clientName} = data
  const {totalAmount} = res 

  await dbAccessor.updateInTransaction(async transaction => {
    const eeiRef = dbAccessor.buildStoreQuery(['eeiRecords', requestId])
    const balanceRef = dbAccessor.buildStoreQuery(['systemBalance', clientKey])
    const transactionRef = dbAccessor.buildStoreQuery(['systemTransactions']).doc()
    const balanceDoc = await transaction.get(balanceRef)
    let {balance, expenseHistory} = balanceDoc.data()
    let newExpenseHistory = new ExpenseHistory(expenseHistory)

    transaction.update(balanceDoc.ref, dbAccessor.addUpdateDocTimestamp({
      balance: toMoney(balance - totalAmount),
      expenseHistory: newExpenseHistory.drawbackExpense(totalAmount, new Date())
    }))
    transaction.set(transactionRef, dbAccessor.addNewDocTimestamp({
      amount: -toMoney(totalAmount),
      newBalance: toMoney(balance - totalAmount),
      clientKey,
      clientName,
      note: `Cancel EEI: ${requestId}.`,
      type: 'adjust',
      subtype: 'eei',
      keywords: ['eei', 'D', requestId, 'cancel']
    }))
    transaction.update(eeiRef, {
      status: 'canceled'
    })
  })
  return res
}
