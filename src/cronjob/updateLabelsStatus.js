/* eslint-disable no-await-in-loop */

import { trackMultipleLabelByCarrier } from '../processShippingLabel'

const LABEL_LIMIT = 40
const THIRTY_DAYS_MILLISECONDS = 2592000000
const CARRIER_QUERY_INDEX = {
  usps: 0,
  fedex: 1,
  ups: 2
}
/**
 *
 * @param {import('../typings').ViteFuncContext} context
 */
export default async function updateLabelsStatus(context) {
  const { db, dbAccessor } = context.appContext
  const oneMonthAgo = new Date(Date.now() - THIRTY_DAYS_MILLISECONDS)
  // collect labels need to update tracking info
  const outboundLabelQuery = db
    .collection('labels')
    .where('status', '==', 'in transit')
    .where('hasShipment', '==', true)
    .where('lastModifiedTime', '>=', oneMonthAgo)
    .orderBy('lastModifiedTime')
  
  const labelQuery = db
    .collection('labels')
    .where('status', 'in', ['ready', 'in transit'])
    .where('hasShipment', '==', false)
    .where('lastModifiedTime', '>=', oneMonthAgo)
    .orderBy('lastModifiedTime')

  const counts = await Promise.all([
    trackLabelByFirestoreQuery('shipment', db, dbAccessor, outboundLabelQuery, LABEL_LIMIT),
    trackLabelByFirestoreQuery('labels', db, dbAccessor, labelQuery, LABEL_LIMIT)
  ])
  logger.log(`Check finished[shipments, labels]: [[${counts[0].join(', ')}], [${counts[1].join(', ')}]]`)
  return counts.reduce((sum, count) => sum + count[1], 0)
}

/**
 * @param {string} carrier carrier name in lower case
 * @param {string[]} trackingNumbers tracking group by same carrier
 * @returns {Promise<Array<object>>}
 */
async function buildTrackingDetailsQuery(carrier, trackingNumbers) {
  if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
    return Promise.resolve([])
  }
  try {
    logger.log(`Query Tracking: [${trackingNumbers.join(', ')}]`)
    const trackings = await trackMultipleLabelByCarrier(carrier, trackingNumbers)
      .then(res => {
        return Array.isArray(res.data) ? res.data : []
      })
    return trackings
  } catch (e) {
    logger.error(e)
    return []
  }
}

/**
 * update label status but not updated last modified time
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {import('firebase-admin').firestore.Query} query 
 * @param {number} queryLimit 
 * @param {import('firebase-admin').firestore.DocumentSnapshot} [startAfter]
 */
async function trackLabelByFirestoreQuery(note, db,dbAccessor, query, queryLimit, startAfter, count = [0, 0]) {
  let labelsCol = await (startAfter ? query.limit(queryLimit).startAfter(startAfter).get() : query.limit(queryLimit).get())
  logger.log(`process ${note || ''} done: [${count.join(', ')}], new: ${labelsCol.size}`)
  const carrierGroup = {
    usps: [],
    fedex: [],
    ups: []
  }
  const labelInfos = [] // {trackingDetails,labelRef, carrier, carrierIndex, trackingNumber, clientKey, orderKey?}
  let updatedQty = 0

  labelsCol.forEach((doc) => {
    const { carrier = 'usps', trackingNumber = '', orderKey, clientKey, trackingDetails = [] } = doc.data()
    const lowerCaseCarrier = carrier.toLowerCase()
    labelInfos.push({
      trackingDetails,
      labelRef: doc.ref,
      carrier: lowerCaseCarrier,
      carrierIndex: carrierGroup[lowerCaseCarrier].length,
      trackingNumber,
      clientKey,
      orderKey,
    })
    carrierGroup[lowerCaseCarrier].push(trackingNumber)
  })
  const TrackingDetails = await Promise.all(
    [
      buildTrackingDetailsQuery('usps', carrierGroup.usps),
      buildTrackingDetailsQuery('fedex', carrierGroup.fedex),
      buildTrackingDetailsQuery('ups', carrierGroup.ups)
    ]
  )
  const trackingNumberTrackingDetailMap = new Map()
  for (let trackingDetailsGroupByCarrier of TrackingDetails) {
    for (let trackingDetail of trackingDetailsGroupByCarrier) {
      const trackingNumber = trackingDetail.trackingNumber
      trackingNumberTrackingDetailMap.set(trackingNumber, trackingDetail)
    }
  }
  const rtn = await Promise.all(labelInfos.map(async labelInfo => {
    const trackingDetail = trackingNumberTrackingDetailMap.get(labelInfo.trackingNumber)
    if (!trackingDetail || trackingDetail.error || !trackingDetail.status || trackingDetail.status === 'error') {
      return Promise.resolve(`label [${labelInfo.trackingNumber}]: no data available`)
    }
    if (labelInfo.trackingDetails.length < trackingDetail.details.length) {
      const promises = []
      if (labelInfo.orderKey) { 
        promises.push(db.doc(`tenants/${labelInfo.clientKey}/orders/${labelInfo.orderKey}`).update({
          ['trackingDetailMap.' + labelInfo.trackingNumber]: {
            status: trackingDetail.status.toLowerCase(),
            carrier: labelInfo.carrier,
            trackingDetails: trackingDetail.details || [],
          }
        })
        .then(async () => {
          await labelInfo.labelRef.update({
            status: trackingDetail.status.toLowerCase(),
            trackingDetails: trackingDetail.details,
          })
        })
        .catch(async e => {
          if (e.code === 'not-found') {
            await labelInfo.labelRef.update({orderKey: ''})
          }
          logger.log(e)
        }))
      }
      await Promise.all(promises)
      updatedQty += 1
      return Promise.resolve(`label [${labelInfo.trackingNumber}]: updated`)
    }
    return Promise.resolve(`label [${labelInfo.trackingNumber}]: no new data`)
  }))
  logger.log(rtn)
  
  if (labelsCol.size === queryLimit) return trackLabelByFirestoreQuery(note, db, dbAccessor, query, queryLimit, labelsCol.docs[labelsCol.size - 1], [count[0] + labelsCol.size, count[1] + updatedQty])
  return [count[0] + labelsCol.size, count[1] + updatedQty]
}
