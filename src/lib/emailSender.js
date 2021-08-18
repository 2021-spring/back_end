'use strict';
import dbAccessor from '../utils/dbAccessor'
import nodemailer from 'nodemailer'
import * as auth from '../config/gmail_auth'
import env from '../config/env'

function chunkArray (originArray, chunk_size) {
  let tempArray = [...originArray]
  let results = []

  while (tempArray.length) {
    results.push(tempArray.splice(0, chunk_size))
  }

  return results
}

export default async function sendMail(receivers, subject='Notice', body='Hello from Viteusa.com', sender) {
  if (!receivers || !Array.isArray(receivers) || !receivers.length) {
    return 'There is no receiver'
  }

  if (!sender && sender !== '') {
    sender = (Math.floor(Math.random() * 2) + 1).toString()
  }

  let emailAuth = auth['support_account' + sender]
  logger.log('email auth: ', emailAuth)
  let transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: emailAuth
  });
  let emailDoc = await dbAccessor.query('sysAdmin', 'general')
  let emailGroupSize = emailDoc.data().emailGroupSize || 5
  // email = email || 'vite.support@viteusa.com'
  let email = emailAuth.user || 'vite.support@viteusa.com'
  let emailGroups = chunkArray(receivers, emailGroupSize) // gmail has 100 receiver limitation
  // let promises = emailGroups.map((group, index) => {
  //   let mailOptions = {
  //     from: email, // sender address
  //     to: index === 0 ? email : '', // only send the first email to support
  //     bcc: group, // list of receivers
  //     subject: subject, // Subject line
  //     html: body // plain text body
  //   };

  //   return transporter.sendMail(mailOptions)

  // })
  env.envType !== 'production' && (subject = `${env.envType} | ${subject}`)

  let sentFirstEmail = false
  let totalEmailSent = 0
  /* eslint-disable no-await-in-loop */
  for (let group of emailGroups) {
    let mailOptions = {
      from: email, // sender address
      to: sentFirstEmail ? '' : email, // only send the first email to support
      bcc: group, // list of receivers
      subject: subject, // Subject line
      html: body // plain text body
    };

    sentFirstEmail = true
    await transporter.sendMail(mailOptions)
    totalEmailSent++
  }
   /* eslint-enable no-await-in-loop */


  logger.log(`send email from: ${email}. emailGroupSize: ${emailGroupSize}, emailSent: ${totalEmailSent}, Total receivers: ${receivers.length}, total groups: ${emailGroups.length}`)
  return 'success'
}