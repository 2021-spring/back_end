'use strict';
import * as auth from '../config/sendGrid_auth'
import sgMail from '@sendgrid/mail'
import env from '../config/env'
import { isEmail } from '../utils/tools';

function chunkArray (originArray, chunk_size) {
  let tempArray = [...originArray]
  let results = []

  while (tempArray.length) {
    results.push(tempArray.splice(0, chunk_size))
  }

  return results
}

export default async function sendMail(receivers, subject='Notice', body='Hello from Viteusa.com', from) {
  if (!receivers || !Array.isArray(receivers) || !receivers.length) {
    return 'There is no receiver'
  }

  let sender = isEmail(from) ? from : 'vite.support@viteusa.com'
  let emailGroupSize = 500
  let emailGroups = chunkArray(receivers, emailGroupSize) // gmail has 100 receiver limitation
  env.envType !== 'production' && (subject = `${env.envType} | ${subject}`)
  sgMail.setApiKey(auth.SENDGRID_API_KEY);
  
  let promises = emailGroups.map(group => {
      let msg = {
        to: group,
        from: sender,
        subject: subject,
        html: body,
      };
      
      return sgMail.sendMultiple(msg);
  })

  return Promise.all(promises)
    .then(rtn => {
      logger.log(`sendGrid email from: ${sender}. emailGroupSize: ${emailGroupSize}, Total receivers: ${receivers.length}, total groups: ${emailGroups.length}`)
      return 'success'
    })
    .catch(error => {
      logger.error('send mail failed. ', error)
    })
}