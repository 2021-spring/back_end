import * as functions from "firebase-functions"
import sendMail from '../lib/sendGridEmailSender'

async function sendEmail (dbAccessor, shipment) {
  let {userKey, warehouseKey = ''} = shipment
  let doc
  let predicates = [{
    field: `warehouses`,
    compare: 'array-contains',
    value: userKey
  }]
  if (warehouseKey) {
    let docs = await dbAccessor.queryWithPredicates(predicates, 'users')
    doc = docs.docs[0]
  } else {
    doc = await dbAccessor.query('users', userKey)
    if (!doc.exists) {
      let docs = await dbAccessor.queryWithPredicates(predicates, 'users')
      doc = docs.docs[0]
    }
  }

  if (!doc.exists) return Promise.reject(Error('canot find the user to send email to'))
  let {email, name} = doc.data()

  let receivers = [email]
  let subject = 'Shipment request canceled'

  let body = `
    <p>Organization ${shipment.tenantName} canceled a shipment</p>
    ${shipment.products.map(product => {
      return `
        <br>------------------------------
        <br>Product: ${product.condition} - ${product.name}
        <br>Quantity: ${product.toShip}
        <br>Location: ${product.siteName}
        <br>UPC: ${product.upc}
        <br>
      `
    })}
    `
  return sendMail(receivers, subject, body)

}

export default function deleteShipmentTriggerFunc(appContext) {
  return functions.firestore.document('shipments/{shipmentKey}').onDelete((snap, context) => {
    let {dbAccessor} = appContext
    let shipment = snap.data()
    let tenantKey = shipment.tenantKey
    logger.log('shipment deleted: ', shipment)

    // send notification email
    return sendEmail(dbAccessor, shipment)
    .then(() => {
      return 'remove successful'
    })
  });
}
