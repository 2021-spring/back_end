// import sendMail from '../lib/emailSender'
import sendMail from '../lib/sendGridEmailSender'
import {toDateString} from '../utils/tools'

export default function notifyPaymentFinished(data, context) {
    let dbAccessor = context.appContext.dbAccessor
    const {uid, token = {}} = context.auth
    let {userKey, userName, tenantKey, tenantName, amount, methodName, note = '', estimateDeliverDate} = data
    estimateDeliverDate = estimateDeliverDate ? new Date(estimateDeliverDate) : new Date()
    return dbAccessor.query('users', userKey)
        .then(doc => {
            if (!doc.exists) return Promise.reject(Error('Invalid user for payment'))
            let email = doc.data().email
            let receivers = [email]
            let subject = 'Requested payment is paid'
            let body = `
            <p>Organization ${tenantName} just paid your payment request</p>
            <br>------------------------------
            <br>Payment method: ${methodName}
            <br>Estimate deliver date: ${toDateString(estimateDeliverDate)}
            <br>Amount: $${amount}
            <br>
            <br>Note: ${note}
            <br>
            <br>
            <br>*** There could be some delay before you see the transaction in your bank account or receive the check depending on the payment method
        
            `
        
            return sendMail(receivers, subject, body)
        })
}
