import moment from 'moment'

export default async function getServerTime () {
  let curTime = moment().utc(5).format()
  return curTime
}