// JSDoc typedefs — no runtime export

/**
 * @typedef {Object} LeadContext
 * @property {number} id
 * @property {string|null} businessName
 * @property {string|null} websiteUrl
 * @property {string|null} ownerName
 * @property {string|null} city
 * @property {string|null} country
 * @property {string|null} category
 */

/**
 * @typedef {Object} Signal
 * @property {string} signalType
 * @property {string} headline
 * @property {string|null} url
 * @property {Object} payload
 * @property {number} confidence
 * @property {string|null} signalDate
 */

/**
 * @typedef {Object} AdapterResult
 * @property {string} source
 * @property {Signal[]} signals
 * @property {string|null} error
 * @property {number} durationMs
 */

export {};
