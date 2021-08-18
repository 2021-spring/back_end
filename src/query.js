import getUpcDetails from './getUpcDetails'

export default function query(data, context) {
  const { type } = data
  const { dbAccessor } = context.appContext
  
  if (!type) return Promise.reject(Error('type-payload-missing'))
  
  if (type === 'getUpcDetails') {
    return getUpcDetails(data, dbAccessor)
  }

  return 'no ops'
}
