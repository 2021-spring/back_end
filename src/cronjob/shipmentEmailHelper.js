import sendMail from '../lib/sendGridEmailSender'
import {toDateString} from '../utils/tools'
import { url } from '../config/env'

export default function shipmentEmailHelper (receivers) {
  let subject = `Shipment confirm warning - ${toDateString(new Date())}`
  let body = `
    <p>Dear user, </p>
    <br>You have shipment(s) past confirm due date.
    <br>The request payment feature will be disabled for relevant organization.
    <br><a clicktracking=off href="${url}/outBoundHistory">go to ViteUSA</a>
    <br>ViteUSA tech-support
  `
  logger.log('all receivers: ', receivers)
  return sendMail(receivers, subject, body)
}