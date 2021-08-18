import {isEmail} from './utils/tools'
import sendMail from './lib/sendGridEmailSender'
/**
 * 
 * @param {{
 *  subject: string,
 *  body: string,
 *  recievers: string | Array<string>,
 *  cc?: Array<string>
 * }} data 
 * @param {{
 *  appContext: {
 *    dbAccessor: dbAccessor, 
 *    admin, db, firebase, bucket, dbFieldValue
 *  },
 *  auth: {
 *    uid: string,
 *    token: {
 *      name: string,
 *      picture: string,
 *      email: string
 *    }
 *  }
 * }} context 
 */
export default function sendEmail (data, context) {
  const {subject = '', body = ''} = data
    let {recievers = [], cc = []} = data
  const {auth = {}} = context
  const {dbAccessor} = context.appContext
  let sender = auth.token && auth.token.email 

  if (!subject) throw Error('invalid-email-subject')
  if (!body) throw Error('invalid-email-body')
  if (Array.isArray(recievers)) {
    recievers = recievers.filter(reciever => isEmail(reciever))
    if (recievers.length === 0) throw Error('no-email-reciever')
  } else {
    if (typeof recievers === 'string' && isEmail(recievers)) {
      recievers = [recievers]
    } else throw Error('invalid-email-revievers')
  }

  return sendMail(recievers, subject, bodyBuilder(body), sender)
}

function bodyBuilder (content) {
  return `
    <div 
      style="
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-all;
      "
    >${content}</div>
  `
}