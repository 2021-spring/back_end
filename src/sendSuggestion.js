// import sendMail from './lib/emailSender'
import sendMail from './lib/sendGridEmailSender'

export default function sendSuggestion(data, context) {
    let {name, email, comment} = data
    logger.log('got suggestion: ', data)
    let receivers = ['vite.support@viteusa.com']
    let subject = `New suggestion from ${name}`

    let body = `
        <br>detail:
        <br>${name} - ${email}
        <br>
        <br>${comment}
        <br>
        <br>
    `

    return sendMail(receivers, subject, body)
}