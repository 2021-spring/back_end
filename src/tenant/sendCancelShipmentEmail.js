// import sendMail from '../lib/emailSender'
import sendMail from '../lib/sendGridEmailSender'

async function sendEmail (dbAccessor, shipment) {
  let {userKey, tenantKey, warehouseKey = '', tenantName, orgEmail, keywords, packageQty} = shipment
  let doc
  let predicates = [{
    field: `warehouses`,
    compare: 'array-contains',
    value: userKey
  }]
  if (warehouseKey) {
    let docs = await dbAccessor.queryWithPredicates(predicates, 'users')
    doc = docs.docs[0]
  } else if (userKey === tenantKey) {
    let predicates = [{
      field: `organizations`,
      compare: 'array-contains',
      value: tenantKey
    }]
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
  let subject = `${shipment.tenantName} | Shipment ${keywords[0] | ''} request canceled`

  let body = `
    <p>Organization ${tenantName} canceled a shipment</p>
    <br>Email: ${orgEmail}
    <br>ID: ${keywords[0]}
    <br>Package quantity: ${packageQty}
    <br>
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

export default function sendCancelShipmentEmail (data, context) {
    let {dbAccessor} = context.appContext
    let shipment = {...data}
    // TODO need to remove label
    // send notification email
    return sendEmail(dbAccessor, shipment)
    .then(() => {
      return 'remove successful'
    })
}