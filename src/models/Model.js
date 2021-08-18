import ModelConfig from './ModelConfig'


export default class Model extends ModelConfig {

  /** @protected */
  static baseFields() {
    return {
      createTime: this.attr(new Date()),
      lastModifiedTime: this.attr(new Date()),
    }
  }

  /** @override */
  static fields() {
    return {}
  }

  constructor(data) {
    super()
    this.schema = {
      ...this.constructor.baseFields(),
      ...this.constructor.fields()
    }
    Object.keys(this.schema).forEach(key => {
      this[key] = this.schema[key](data[key])
    })
  }

  static string (init, prefix = (value) => value) {
    if (typeof init !== 'string' && init !== undefined) throw Error('initial-value-type-error')

    return (value) => {
      value = prefix(value)
      if (value === undefined || value === null) {
        return init
      }
      if (typeof value === 'string') {
        return value
      }
      return String(value)
    }
  }

  static boolean (init, prefix = (value) => value) {
    if (typeof init !== 'boolean' && init !== undefined) throw Error('initial-value-type-error')

    return (value) => {
      value = prefix(value)
      if (value === undefined || value === null) {
        return init
      }
      if (typeof value === 'boolean') {
        return value
      }
      if (typeof value === 'string') {
        if (value.length === 0) {
          return false
        }
        let int = parseInt(value, 0)
        return isNaN(int) ? true : Boolean(int)
      }
      if (typeof value === 'number') {
        return Boolean(value)
      }
      return false
    }
  }

  static number (init, prefix = (value) => value) {
    if (typeof init !== 'number' && init !== undefined) throw Error('initial-value-type-error')

    return (value) => {
      value = prefix(value)
      if (value === undefined || value === null) {
        return init
      }
      if (typeof value === 'number') {
        return value
      }
      if (typeof value === 'string') {
        return parseFloat(value)
      }
      if (typeof value === 'boolean') {
        return value ? 1 : 0
      }
      return 0
    }
  }

  static attr (init, prefix = (value) => value) {
    return (value) => {
      value = prefix(value)
      value = (value === undefined || value === null) ? init : value
      // Default Value might be a function (taking no parameter)
      if (typeof value === 'function') {
        return value()
      }
      return value
    }
  }

  static isRequired (fieldName) {
    return (value) => {
      if (value === undefined || value === null) throw Error(`model-${fieldName}-field-missing`)
      return value
    }
  }


  getData () {
    let data = {}
    let dataFields = {
      ...this.constructor.baseFields(),
      ...this.constructor.fields()
    }
    Object.keys(dataFields).forEach(key => {
      data[key] = this[key]
    })
    return data
  }
}

