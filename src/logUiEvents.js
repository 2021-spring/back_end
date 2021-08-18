
export default function logUiEvents(data, context) {
    const {uid, token = {}} = context.auth
    const {name = null, picture = null, email = null} = token
    let {messages = [], version = 'unknown'} = data

    return Promise.all(messages.map(message => {
        if (typeof message === 'object') {
            if (message.isError) {
                logger.error(`UI event-- version(${version}), uid(${uid}, name(${name}), message(${JSON.stringify(message)})`)
            } else {
                logger.log(`UI event-- version(${version}), uid(${uid}, name(${name}), message(${JSON.stringify(message)})`) 
            }
        } else {
            logger.log(`UI event-- version(${version}), uid(${uid}, name(${name}), message(${message})`) 
        }
        
        
    }))
}