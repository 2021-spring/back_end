import moment from 'moment'
import momenttz from 'moment-timezone'
import Decimal from 'decimal.js'
import cloneDeep from 'lodash/cloneDeep'

export class ExpenseHistory {
  constructor (expenseHistory) {
    this.expenseHistory = cloneDeep(expenseHistory) || []
    const currentTime = new Date()
    this.curKeyStr = `${currentTime.getFullYear()}-${currentTime.getMonth() + 1}`
  }

  addExpense (balanceDiff) {
    let tailMonth = this.expenseHistory[this.expenseHistory.length - 1]
    if (tailMonth && this.curKeyStr === tailMonth.dateKeyStr) {
      tailMonth.expense = addNumbers(balanceDiff, tailMonth.expense || 0)
    } else {
      this.expenseHistory.push({
        dateKeyStr: this.curKeyStr,
        expense: toMoney(balanceDiff)
      })
    }

    if (this.expenseHistory.length > 12) {
      this.expenseHistory.shift()
    }

    return this.expenseHistory
  }

  drawbackExpense (balanceDiff, date) {
    const keyStr = `${date.getFullYear()}-${date.getMonth() + 1}`
    let targetMonth = this.expenseHistory.find(item => item.dateKeyStr === keyStr)
    targetMonth.expense = toMoney(targetMonth.expense + balanceDiff)
    return this.expenseHistory
  }
}

export class WarehouseStat {
  constructor (data) {
    this.data = data || {
      monthlyStat: [],
      dailyStat: []
    }
    const currentTime = new Date()
    this.curMonthKeyStr = `${currentTime.getFullYear()}-${(currentTime.getMonth() + 1).toString().padStart(2, '0')}`
    this.curDateKeyStr = `${this.curMonthKeyStr}-${currentTime.getDate().toString().padStart(2, '0')}`
  }

  addStatByProducts (additionObj, workerKey, workerName) {
    this.addMonthlyStat(additionObj, workerKey, workerName)
    this.addDailyStat(additionObj, workerKey, workerName)
    this.trimStat()
  }

  addMonthlyStat (additionObj, workerKey, workerName) {
    let tailMonth = this.data.monthlyStat[this.data.monthlyStat.length - 1]
    if (tailMonth && this.curMonthKeyStr === tailMonth.monthKeyStr) {
      this.addToStat(tailMonth, additionObj)
      tailMonth.workers = tailMonth.workers || []
      const targetWorker = tailMonth.workers.find(worker => worker.workerKey === workerKey)
      if (targetWorker) {
        targetWorker.packages += additionObj.packages
      } else {
        tailMonth.workers.push({
          workerKey,
          workerName,
          packages: additionObj.packages
        })
      }
    } else {
      this.data.monthlyStat.push({ 
        monthKeyStr: this.curMonthKeyStr, 
        ...additionObj,
        workers: [{
          workerKey,
          workerName,
          packages: additionObj.packages
        }] 
      })
    }
  }

  addToStat (statObj, additionObj) {
    Object.keys(additionObj).forEach((key) => {
      statObj[key] += additionObj[key]
    })
  }

  addDailyStat (additionObj, workerKey, workerName) {
    let tailDate = this.data.dailyStat[this.data.dailyStat.length - 1]
    if (tailDate && this.curDateKeyStr === tailDate.dateKeyStr) {
      this.addToStat(tailDate, additionObj)
      tailDate.workers = tailDate.workers || []
      const targetWorker = tailDate.workers.find(worker => worker.workerKey === workerKey)
      if (targetWorker) {
        targetWorker.packages += additionObj.packages
      } else {
        tailDate.workers.push({
          workerKey,
          workerName,
          packages: additionObj.packages
        })
      }
    } else {
      this.data.dailyStat.push({ 
        dateKeyStr: this.curDateKeyStr, 
        ...additionObj,
        workers: [{
          workerKey,
          workerName,
          packages: additionObj.packages
        }] 
      })
    }
  }

  trimStat () {
    while (this.data.monthlyStat.length > 36) {
      this.data.monthlyStat.shift()
    }
    while (this.data.dailyStat.length > 365) {
      this.data.dailyStat.shift()
    }
  }

  getData () {
    return this.data
  }
}

export function getIsoTime () {
  return new Date().toISOString()
}

export function getTime () {
  return new Date().getTime()
}

export function toTimestampString (date) {
  return date && moment(date).format('MM/DD/YYYY HH:mm:ss')
}

export function toTimestampTimezoneString (date) {
  return date && momenttz(date).tz('America/New_York').format('MM/DD/YYYY HH:mm:ss z')
}

export function toDateString (date) {
  return date && moment(date).format('MM/DD/YYYY')
}

export function toPickerDateString (date) {
  return date && moment(date).format('YYYY-MM-DD')
}

export function toDateStart (text) {
  return text && moment(text).startOf('day').toDate()
}

export function toDateEnd (text) {
  return text && moment(text).endOf('day').toDate()
}

export function splitTrackingNum (text) {
  text = text.replace(/\n/g, ' ')
  text = text.replace(/,/g, ' ')
  text = text.replace(/\s+/g, ' ')
  text = text.trim()

  let arr = text.split(' ')
  return arr
}

export function splitProductName (text) {
  let originText = text.toLowerCase()

  text = text.replace(/\n/g, ' ')
  text = text.replace(/,/g, ' ')
  text = text.replace(/\./g, ' ')
  text = text.replace(/，/g, ' ')
  text = text.replace(/。/g, ' ')
  text = text.replace(/\s+/g, ' ')
  text = text.trim()

  let arr = text.toLowerCase().split(' ').filter(item => item !== '' && item !== '-')
  let arr2 = []
  for (let i = 0; i < arr.length - 1; i++) {
    arr2.push(`${arr[i]} ${arr[i + 1]}`)
  }
  arr = [...arr, ...arr2, originText]
  return arr
}

// add number with decimal
export function addNumbers (...items) {
  return items.reduce((sum, item) => {
    return sum.plus(item)
  }, new Decimal(0)).toDP(2).toNumber()
}

export function splitKeyword (text) {
  text = text.replace(/\n/g, ' ')
  text = text.replace(/,/g, ' ')
  text = text.replace(/\./g, ' ')
  text = text.replace(/，/g, ' ')
  text = text.replace(/。/g, ' ')
  text = text.replace(/\s+/g, ' ')
  text = text.trim()

  return text.toLowerCase().split(' ').filter(item => item !== '' && item !== '-' && typeof item === 'string')
}

export function toMoney (item) {
  return new Decimal(item).toDP(2).toNumber()
}

export function getRandomIdByTime (withDigits = 3) {
  const timeString = Math.floor(Date.now() / 1000).toString()
  let lastString = ''
  for (let i = 0; i < withDigits; i++) {
    lastString += Math.floor(Math.random() * 10).toString()
  }
  return timeString + lastString
}

/**
 * Sleep method is designed to be used in a async export function with await keyword
 * 
 * @param {number} period the sleep period in millisecond
 */
export function sleep (period) {
  return new Promise(resolve => { setTimeout(resolve, period) })
}

/**
 * 
 * @param {array} arr the array to flat
 * 
 * @return if arr is array, return the flat version (depth 1); If arr is not an array, return arr
 */
export function flatArray (arr) {
  if (Array.isArray(arr)) {
    return arr.reduce((acc, item) => {
      return Array.isArray(item) ? [...acc, ...item] : [...acc, item]
    }, [])
  } else {
    return arr
  }
}

/**
 * Check input string is email or not
 * @param {string} str 
 */
export function isEmail (str) {
  if (!str) return false
  return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(str)
}

class ApiError extends Error {
  constructor (errCode, httpCode, message) {
    super(typeof message === 'object' ? JSON.stringify(message) : message)
    this.errCode = errCode || 'general'
    this.httpCode = httpCode || 500
    if (typeof message === 'object') {
      this.msgObj = message
    }
  }
}

export function axiosWrapper (promise) {
  return promise
    .catch((error) => {
      if (error.response) { // check if is axios standard error
        logger.log('axios wrapper error: ', error.response.data)
        const {code, message} = error.response.data
        if (message === 'Endpoint request timed out') {
          throw new ApiError('internal', 504, 'endpoint-request-timed-out')
        } else if (code === 'shipvv-internal-1000') {
          logger.error('SHIPVV low balance', error.response.data)
        }
        throw new ApiError(code, error.response.status, message)
      }

      throw error
    })
}

export function convertTimestampToDateInObj (obj) {
  for (let a in obj) {
    if (typeof (obj[a]) === 'object' && obj[a] !== null) {
      if (typeof obj[a].toDate === 'function') {
        obj[a] = obj[a].toDate()
      } else {
        convertTimestampToDateInObj(obj[a])
      }
    }
  }
}

/**
 * @example Review code -> reviewCode
 * @param {string} str 
 */
export function phraseToCamelCase (str) {
  let newStr = str.split(' ').map(piece => piece[0].toUpperCase() + piece.slice(1).toLowerCase()).join('')
  newStr = newStr[0].toLowerCase() + newStr.slice(1)
  return newStr
}

/**
 * @example review-code -> reviewCode
 * @param {string} string 
 */
export function dashToCamelStyle (string) {
  let res = ''
  for (let i = string.length - 1; i >= 0; i--) {
    if (string[i] !== '-') {
      if (string[i - 1] === '-') {
        res = string[i].toUpperCase() + res
      } else {
        res = string[i] + res
      }
    }
  }
  return res
}

export const statesToAbbrev = {
  'Alabama': 'AL',
  'Alaska': 'AK',
  'American Samoa': 'AS',
  'Arizona': 'AZ',
  'Arkansas': 'AR',
  'California': 'CA',
  'Colorado': 'CO',
  'Connecticut': 'CT',
  'Delaware': 'DE',
  'Florida': 'FL',
  'Georgia': 'GA',
  'Hawaii': 'HI',
  'Idaho': 'ID',
  'Illinois': 'IL',
  'Indiana': 'IN',
  'Iowa': 'IA',
  'Kansas': 'KS',
  'Kentucky': 'KY',
  'Louisiana': 'LA',
  'Maine': 'ME',
  'Maryland': 'MD',
  'Massachusetts': 'MA',
  'Michigan': 'MI',
  'Minnesota': 'MN',
  'Mississippi': 'MS',
  'Missouri': 'MO',
  'Montana': 'MT',
  'Nebraska': 'NE',
  'Nevada': 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  'Ohio': 'OH',
  'Oklahoma': 'OK',
  'Oregon': 'OR',
  'Pennsylvania': 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  'Tennessee': 'TN',
  'Texas': 'TX',
  'Utah': 'UT',
  'Vermont': 'VT',
  'Virgin Island': 'VI',
  'Virginia': 'VA',
  'Washington': 'WA',
  'West Virginia': 'WV',
  'Wisconsin': 'WI',
  'Wyoming': 'WY'
}

export const abbrevToStates = Object.entries(statesToAbbrev).reduce((acc, [key, val]) => {
  acc[val] = key
  return acc
}, {}) 

/** @param {string} fileName **/
export function getFileSuffix (fileName) {
  return (fileName || '').split('.').slice(-1)[0]
}

export class MeasurementTools {
  static cm_inch (cm) {
    return new Decimal(cm / 2.54).toDP(2).toNumber()
  }
  static kg_lbs (kg) {
    return new Decimal(kg * 2.205).toDP(2).toNumber()
  }
}

/**
 * All the documents keywords contains lower case for keyword search
 * This method general convert string array to lower case string array
 * @param {string[]} keywords 
 * @returns {string[]}
 */
export function formatKeywords(keywords) {
  return keywords.map(keyword => keyword.toLowerCase())
}
