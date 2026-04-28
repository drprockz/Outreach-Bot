import { builder } from './builder.js'
import './resolvers/leads.js'

export const schema = builder.toSchema()
