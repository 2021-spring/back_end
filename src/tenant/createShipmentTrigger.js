import * as functions from "firebase-functions"
import {processShipmentLabelFiles, sendShipmentEmail} from '../shipmentLabelHelper'

export default function createShipmentTriggerFunc(appContext) {
  return functions.firestore.document('shipments/{shipmentKey}').onCreate(async (snap, context) => {
    let {dbAccessor, bucket} = appContext
    let shipment = snap.data()
    if (shipment.status === 'pending') {
      logger.log('pending shipment created: ', shipment)
      return 'done'
    }
    shipment.key = context.params.shipmentKey
    logger.log('shipment created: ', shipment)
    let zipFileInfo = {}

    if (shipment.labels.every(label => label.url)) {
      const labelDocs = await Promise.all(shipment.labels.map(label => dbAccessor.query('labels', label.orderId.split('-')[1])))

      if (labelDocs.length === 0 || labelDocs.every(doc => doc.exists && doc.data().status === 'ready')) {
        zipFileInfo = await processShipmentLabelFiles({
          ...shipment,
          labels: labelDocs.map(doc => {
            const {url, orderId} = doc.data()
            return {url, orderId}
          })
        }, dbAccessor, bucket)
      }
    }

    if (zipFileInfo.zipfileDownloadURL) {
      await sendShipmentEmail(dbAccessor, shipment, zipFileInfo.zipfileDownloadURL || null)
    }
    return 'done'
  })
}
