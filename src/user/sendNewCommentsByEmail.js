import { isEmail, toDateString } from "../utils/tools"
import sendMail from "../lib/sendGridEmailSender"
import { url } from '../config/env'

export default async function sendNewCommentsByEmail (data, context) {
  let { dbAccessor } = context.appContext

  let { senderName, reciever, content, emailContext } = data
  let { type, key } = reciever


  // get reciever's email
  let recieverEmail = await getRecieverEmail(dbAccessor, type, key)

  // check reciever type
  if (recieverEmail.length === 0) {
    logger.log('no email, exit!')
    return
  }
  
  return sendCommentsEmail(type, recieverEmail, content, emailContext, senderName)
}

function getRecieverEmail(dbAccessor, type, key) {
  let recieverFunc = {
    'userPropose': key => getUserReciever(dbAccessor, key),
    'userPayment': key => getUserReciever(dbAccessor, key),
    'tenantPropose': key => getTenantReciever(dbAccessor, key, 'proposeOfferRecieveEmail'),
    'tenantPayment': key => getTenantReciever(dbAccessor, key, 'paymentRequestRecieveEmail'),
    'userProposeReject': key => getUserReciever(dbAccessor, key)
  }

  return recieverFunc[type](key)
}

async function getTenantReciever (dbAccessor, key, recieverEmailType) {
  let tenantLimitInfoDoc = await dbAccessor.query('tenantLimitedInfo', key)
  let tenantLimitInfo = tenantLimitInfoDoc.data()

  if (tenantLimitInfo.recieveEmailfromComment !== true) {
    return ''
  }

  if (isEmail(tenantLimitInfo[recieverEmailType])) {
    return tenantLimitInfo[recieverEmailType]
  }
  
  return ''
}

async function getUserReciever (dbAccessor, key) {
  let userDoc = await dbAccessor.query('users', key)
  let user = userDoc.data()

  return user.email
}

async function sendCommentsEmail(type, recieverEmail, content, emailContext, senderName) {
  let sendEmailFunc = {
    'userPropose': proposeUserRecieverEmail,
    'userPayment': paymentUserRecieverEmail,
    'tenantPropose': proposeTenantRecieverEmail,
    'tenantPayment': paymentTenantRecieverEmail,
    'userProposeReject': proposeRejectUserRecieverEmail
  }
  return sendEmailFunc[type](recieverEmail, content, emailContext, senderName)
}

function emailCommentsTemplate(content = []) {
  let str = `<br>`
  for (let comment of content) {
    str += `
      <br>------------
      <div style="white-space: pre-wrap;"> ${comment}</div>
    `
  }
  
  return str
}

function paymentContextTemplate(paymentContext) {
  let {createTime, amount} = paymentContext
  return `
    <br>Payment request info:
    <br>Create at ${toDateString(createTime)}
    <br>Amount: $ ${amount} 
  `
}

function offerContextTemplate(offerContext) {
  let {createTime, productName, price, quantity} = offerContext
  return `
    <br>------------
    <br>Proposed offer info:
    <br>Create at ${toDateString(createTime)}
    <br>Product: ${productName}
    <br>Price: ${price}
    <br>Quantity: ${quantity}
    <br>------------
  `
}

function paymentUserRecieverEmail(receieverEmail, content, paymentContext, senderName) {
  let subject = `New org(${senderName})'s payment comment(s)`
  let body = `
    <p>Dear user, </p>
    <br>You have new comment(s) for your payment request from ${senderName}:
    ${emailCommentsTemplate(content)}
    ${paymentContextTemplate(paymentContext)}
    <br>
    <br><a clicktracking=off href="${url}/paymentUser">go to ViteUSA</a>
    <br>ViteUSA tech-support
  `
  return sendMail([receieverEmail], subject, body)
}

function paymentTenantRecieverEmail(receieverEmail, content, paymentContext, senderName) {
  let subject = `New user(${senderName})'s payment comment(s)`
  let body = `
    <p>Dear organization, </p>
    <br>You have new comments for your payment request from ${senderName}:
    ${emailCommentsTemplate(content)}
    ${paymentContextTemplate(paymentContext)}
    <br>
    <br><a clicktracking=off href="${url}/paymentTenant">go to ViteUSA</a>
    <br>ViteUSA tech-support
  `
  return sendMail([receieverEmail], subject, body)
}

function proposeUserRecieverEmail(receieverEmail, content, offerContext, senderName) {
  let subject = `New org(${senderName})'s propose comment(s)`
  let body = `
    <p>Dear user, </p>
    <br>You have new comment(s) for your propose offer from ${senderName}:
    ${emailCommentsTemplate(content)}
    ${offerContextTemplate(offerContext)}
    <br>
    <br><a clicktracking=off href="${url}/offer">go to ViteUSA</a>
    <br>ViteUSA tech-support
  `
  return sendMail([receieverEmail], subject, body)
}

function proposeTenantRecieverEmail(receieverEmail, content, offerContext, senderName) {
  let subject = `New user(${senderName})'s propose comments`
  let body = `
    <p>Dear organization, </p>
    <br>You have new comment(s) for your propose offer from ${senderName}:
    ${emailCommentsTemplate(content)}
    <br>
    <br>
    ${offerContextTemplate(offerContext)}
    <br><a clicktracking=off href="${url}/offer">go to ViteUSA</a>
    <br>ViteUSA tech-support
  `
  return sendMail([receieverEmail], subject, body)
}

function proposeRejectUserRecieverEmail(receieverEmail, content, offerContext, senderName) {
  let subject = `Org(${senderName}) had rejected your proposed offer` 
  let body = `
    <p>Dear user, </p>
    <br>Your proposed offer had been rejected
    <br>
    ${offerContextTemplate(offerContext)}
    <br><a clicktracking=off href="${url}/offer">go to ViteUSA</a>
    <br>VireUSA tech-support
  `

  return sendMail([receieverEmail], subject, body)
}