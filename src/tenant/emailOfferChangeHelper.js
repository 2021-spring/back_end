// import sendMail from '../lib/emailSender'
import sendMail from '../lib/sendGridEmailSender'
import getUserForTenantHelper from './getUserForTenantHelper'
import {toDateString} from '../utils/tools'
import env from '../config/env'

export default function emailOfferChangeHelper(tenantKey, dbAccessor, offer, isUpdated = false) {
    if (offer.isNotifyMembers) {
      return getUserForTenantHelper(tenantKey, dbAccessor, 2)
        .then(users => {
            let receivers = users.reduce((theEmails, user) => {
              if (Array.isArray(offer['userVisible']) && offer['userVisible'].includes(user.uid))
              theEmails.push(user.email)
              return theEmails
            }, [])

            let subject = `${offer.tenantName} | ${isUpdated ? 'Updated' : 'New'} Offer(#${offer.key}) - ${offer.productName}`
            let {quantity, taken = 0} = offer
            let body = `
              <p>${offer.tenantName} has ${isUpdated ? 'updated the' : 'added a new'} offer</p>
              <p>Offer ID: <b>${offer.key}</b></p>
              <br>${offer.productCondition} - ${offer.productName}
              <br>Price: $ ${offer.price}
              <br>Available quantity: ${quantity - taken}
              <br>Expiration: ${offer.expirationDate ? toDateString(offer.expirationDate) : 'none'}
              <div style="white-space: pre-wrap;">Note: <br>${offer.note ? offer.note : ''}</div>
              <br>
              <div><a clicktracking=off href="${env.url + `/offer?id=${offer.key}`}">Take this offer here</a><div>
              <br>Addresses:`

            let addressTrs = offer.warehouseSites && offer.warehouseSites.reduce((result, site) => {
              return (result + `<tr><td>${site.siteName}</td><td>${site.orgId ? site.orgId : ''}</td><td>${site.address1}${site.address2 ? `, ${site.address2}` : ''}, ${site.orgId ? `Unit ${site.orgId}, ` : ''}${site.city}, ${site.state} ${site.zip}</td></tr>`)
            }, `<table border="1"><tr><td>Site name</td><td>Organization ID</td><td>Address</td></tr>`)
            
            addressTrs += `</table>`
            
            return sendMail(receivers, subject, (body + addressTrs))
        })
    } else {
      return 'Not required to notify members, no email is sent '
    }
    
}
