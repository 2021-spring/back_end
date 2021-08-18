export class ModelError extends Error {
  /**
   * 
   * @param {string} code 
   * @param {string} message 
   */
  constructor(code, message) {
    super(message)
    this.code = code
  }
}