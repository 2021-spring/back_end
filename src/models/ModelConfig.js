import { ModelError } from "./Error"

/**
 * @typedef {object} 
 * 
 * @property  dbAccessor
 */
let modelOptions = {
  isInitialized: false
}

let optionsProxy = new Proxy(modelOptions, {
  get(target, prop) {
    if (prop in modelOptions) {
      return modelOptions[prop]
    }
    throw new ModelError('error-config', `property[${prop}] is not exist`)
  }
})

export default class ModelConfig {
  static initialize(options) {
    modelOptions = {
      isInitialized: true,
      ...options
    }
  }
  /** @returns {import('../utils/dbAccessor').default} */
  static get dbAccessor() {
    return optionsProxy.dbAccessor
  }
  /** @returns {import('../utils/dbAccessor').default} */
  get dbAccessor() {
    return optionsProxy.dbAccessor
  }
}