const axios = require('axios')

export default async function getUpcDetails (data, dbAccessor) {
  const {upc} = data
  const upcDoc = await dbAccessor.query('upcInfos', upc)
  if (upcDoc.exists) {
    return {...upcDoc.data(), remaining: '-1'}
  }
  
  const rtn = await getUpcFromApi (data)
  const {remaining, ...rest} = rtn 
  await dbAccessor.update(rest, 'upcInfos', upc)
  return rtn
}

async function getUpcFromApi (data) {
  const {upc} = data
  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`
  let result = {
    url,
    name: '',
    detail: '',
    image: ''
  }
  try {
    const response = await axios.get(url);
    const data = response.data
    const { 'x-ratelimit-limit': limit, 'x-ratelimit-reset': resetTime, 'x-ratelimit-remaining': remaining} = response.headers
    logger.log(`query limits: limit=${limit}, remaining=${remaining}, resetTime=${resetTime && new Date(parseInt(resetTime)*1000)}` )
    if (data.total) {
      const {title, description, images} = data.items[0];
      result.name = title
      result.detail = description
      images.length && (result.image = images[0])
      result.remaining = remaining
    }
  } catch (error) {
    logger.log(error);
  }

  logger.log(result)
  return result
}