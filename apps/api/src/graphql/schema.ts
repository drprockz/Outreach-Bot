import { builder } from './builder.js'
import './resolvers/leads.js'
import './resolvers/me.js'
import './resolvers/orgs.js'
import './resolvers/admin.js'

export const schema = builder.toSchema()
