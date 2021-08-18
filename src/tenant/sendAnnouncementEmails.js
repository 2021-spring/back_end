import sendMail from '../lib/sendGridEmailSender'
import { url } from '../config/env'

export default function sendAnnouncementEmails (data, context) {
  const {
    receivers = [],
    msgContent = '',
    startDate = '',
    endDate = ''
  } = data
  if (!typeof msgContent === 'string' || msgContent.length === 0) {
    return 'error Announcement content'
  }

  const subject = `${context.auth.token && context.auth.token.name} made an announcement` 
  const body = `
    <p>Dear user, </p>
    <div style="white-space: pre-wrap; overflow-wrap: break-word;">${msgContent}</div>
    <br>
    ${ 
      startDate && endDate
      ?
      `<p>Valid: ${startDate} -- ${endDate}</p>`
      :
      ``
    }
    <br>
    <br><a clicktracking=off href="${url}">go to ViteUSA</a>
    <br>ViteUSA tech-support
  `

  return sendMail(receivers, subject, body)
}
